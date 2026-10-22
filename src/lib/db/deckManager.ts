/**
 * deckManager — manages per-deck SQLite database instances.
 *
 * Each deck gets its own sql.js Database that is loaded from a DeckSnapshot
 * (from iCloud) and kept in sync via edit file replay. The DeckManager:
 *
 *   1. Opens/caches per-deck Database instances on demand.
 *   2. Provides writeEdit() to persist changes to both local DB and iCloud.
 *   3. Replays incoming edits from other devices.
 *   4. Handles compaction after study sessions.
 *   5. Manages the deck registry (list of known decks).
 *
 * The local per-deck DB uses the same schema as the old monolithic kit.db
 * (minus the media table), so all queries.ts functions work unchanged.
 */

import type { Database, SqlJsStatic } from 'sql.js';
import { ALL_TABLES, ENABLE_FOREIGN_KEYS } from '../db';
import { runMigrations } from '../db/migrations';
import type { SyncStorage } from '../sync/syncStorage';
import type { DeckSnapshot, EditOp, EditFile } from '../sync/types';
import { createHLC, type HLCClock } from '../sync/hlc';
import { writeEdit, flushPendingEdits } from '../sync/editWriter';
import { readEditsAfter, readSnapshot } from '../sync/editReader';
import { replayEdits } from '../sync/replay';
import { mergeJournalEdits, sameJournalBase, snapshotJournal } from '../sync/journal';
import { compareHLC } from '../sync/hlc';
import { compactDeck, snapshotCurrentState } from '../sync/compact';
import {
  initRegistry,
  getDeviceId,
  serializeRegistry,
  upsertDeckEntry,
  getAllDeckEntries,
  getDeckEntry,
  reconcileWithICloud,
  updateDeckMeta,
  getAllGlobalTags,
  upsertGlobalTag,
  deleteGlobalTag,
  renameGlobalTag,
  mergeTagsIntoGlobal,
} from '../sync/deckRegistry';
import { listSyncedDeckIds } from '../sync/editReader';
import type { DeckRegistryEntry } from '../sync/types';
import {
  insertDeck,
  insertCard,
  insertNote,
  insertNoteType,
  insertReviewLog,
  setCardState,
  beginTransaction,
  commitTransaction,
  getAllDecks,
  getAllDeckCardCounts,
  replaceDeckForReplay,
} from '../db/queries';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DeckManagerConfig {
  /** sql.js static module (already initialized with WASM). */
  SQL: SqlJsStatic;
  /** Sync storage backend (iCloud or browser). */
  storage: SyncStorage;
  /** Persisted registry JSON, or null for fresh start. */
  registryJson: string | null;
  /**
   * Read a snapshot from local device storage (not iCloud).
   * Used as the primary/reliable store so decks survive iCloud outages.
   */
  readLocalSnapshot?: (deckId: string) => Promise<string | null>;
  /**
   * Write a snapshot to local device storage (not iCloud).
   * Called before (or instead of) the iCloud write.
   */
  writeLocalSnapshot?: (deckId: string, data: string) => Promise<void>;
  /**
   * Delete the local snapshot directory for a deck.
   * Called during deck deletion to reclaim local storage.
   */
  deleteLocalSnapshot?: (deckId: string) => Promise<void>;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** Open per-deck databases keyed by deckId. */
const openDbs = new Map<string, Database>();

/** Deleted card IDs per deck (for conflict resolution). */
const deletedCards = new Map<string, Set<string>>();

/** HLC of the last replayed edit per deck. */
const watermarks = new Map<string, string>();

interface JournalState { base: DeckSnapshot; edits: EditFile[]; needsReplay?: boolean }
interface ReconciledJournal { count: number; snapshot: DeckSnapshot | null }
const journals = new Map<string, JournalState>();
const revisions = new Map<string, number>();
const localWrites = new Map<string, Set<Promise<unknown>>>();
const reconciliation = new Map<string, Promise<ReconciledJournal>>();
function changed(deckId: string): void { revisions.set(deckId, (revisions.get(deckId) ?? 0) + 1); }


/**
 * Decks whose most recent openDeck attempt could not produce a usable
 * database from either the local or iCloud snapshot. The UI dims these
 * rows and routes the tap to the recovery sheet instead of the study
 * screen. Cleared when openDeck subsequently succeeds (e.g. after the
 * user taps "Try Again" and iCloud has caught up).
 */
const failedOpens = new Set<string>();

/** Listeners notified when failedOpens changes (used by the UI layer). */
const failureListeners = new Set<() => void>();

function markDeckFailed(deckId: string): void {
  if (failedOpens.has(deckId)) return;
  failedOpens.add(deckId);
  failureListeners.forEach(fn => { try { fn(); } catch { /* ignore */ } });
}

function markDeckHealthy(deckId: string): void {
  if (!failedOpens.has(deckId)) return;
  failedOpens.delete(deckId);
  failureListeners.forEach(fn => { try { fn(); } catch { /* ignore */ } });
}

/**
 * Subscribe to deck-health changes. The listener fires whenever a deck
 * transitions between healthy and failed. Returns an unsubscribe function.
 */
export function subscribeToFailureChanges(listener: () => void): () => void {
  failureListeners.add(listener);
  return () => { failureListeners.delete(listener); };
}

/** Whether this deck's last open attempt failed (and no retry has succeeded). */
export function isDeckFailed(deckId: string): boolean {
  return failedOpens.has(deckId);
}

let _SQL: SqlJsStatic | null = null;
let _storage: SyncStorage | null = null;
let _clock: HLCClock | null = null;
let _readLocalSnapshot: ((deckId: string) => Promise<string | null>) | null = null;
let _writeLocalSnapshot: ((deckId: string, data: string) => Promise<void>) | null = null;
let _deleteLocalSnapshot: ((deckId: string) => Promise<void>) | null = null;

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

/**
 * Initialize the DeckManager.
 *
 * @param config - Configuration with sql.js module, storage, and registry JSON.
 */
export function initDeckManager(config: DeckManagerConfig): void {
  _SQL = config.SQL;
  _storage = config.storage;
  _readLocalSnapshot = config.readLocalSnapshot ?? null;
  _writeLocalSnapshot = config.writeLocalSnapshot ?? null;
  _deleteLocalSnapshot = config.deleteLocalSnapshot ?? null;

  const reg = initRegistry(config.registryJson);
  _clock = createHLC(reg.deviceId);
}

/**
 * Discover decks from iCloud and reconcile with local registry.
 *
 * @returns Updated list of deck entries.
 */
export async function discoverDecks(): Promise<DeckRegistryEntry[]> {
  if (!_storage) return getAllDeckEntries();

  try {
    const icloudIds = await listSyncedDeckIds(_storage);
    reconcileWithICloud(icloudIds);
  } catch {
    // iCloud unavailable — use local registry only
  }

  return getAllDeckEntries();
}

// ---------------------------------------------------------------------------
// Per-deck database management
// ---------------------------------------------------------------------------

/**
 * Open (or get cached) a per-deck database.
 *
 * If the database isn't cached, it is built from the iCloud snapshot +
 * any uncompacted edit files.
 *
 * @param deckId - UUID of the deck.
 * @returns The sql.js Database instance, or null on failure.
 */
export async function openDeck(deckId: string): Promise<Database | null> {
  // Return cached if already open
  const cached = openDbs.get(deckId);
  if (cached) return cached;

  if (!_SQL || !_storage) return null;

  try {
    // Try local first. If local is missing, parses-but-is-malformed, or
    // fails to hydrate (e.g. an old interrupted write left a truncated
    // file that still parses as JSON), fall through to iCloud and silently
    // overwrite the bad local copy with the known-good one.
    let snapshot: DeckSnapshot | null = null;
    let db: Database | null = null;

    const localSnapshot = await tryReadLocalSnapshot(deckId);
    if (localSnapshot) {
      const candidate = await buildDbFromSnapshot(_SQL, localSnapshot);
      if (candidate) {
        snapshot = localSnapshot;
        db = candidate;
      }
      // If candidate is null, buildDbFromSnapshot already logged the reason
      // and rolled back. We fall through to iCloud without surfacing the
      // failure to the user — this is the "silent self-heal" case.
    }

    if (!db) {
      const icloudSnapshot = await readSnapshot(_storage, deckId);
      if (icloudSnapshot) {
        const candidate = await buildDbFromSnapshot(_SQL, icloudSnapshot);
        if (candidate) {
          snapshot = icloudSnapshot;
          db = candidate;
          // Heal the local copy by replacing it with the known-good iCloud
          // one. atomicWriteText guarantees the previous bad file is gone
          // before the new one appears, so next open goes through the fast
          // local path.
          if (_writeLocalSnapshot) {
            _writeLocalSnapshot(deckId, JSON.stringify(icloudSnapshot)).catch(() => {});
          }
        }
      }
    }

    if (!db || !snapshot) {
      markDeckFailed(deckId);
      return null;
    }

    markDeckHealthy(deckId);

    // A legacy snapshot is a fixed migration baseline. Never advance its
    // coverage just because our own or a later remote edit arrived first.
    const checkpoint = snapshotJournal(snapshot);
    const observed = await readEditsAfter(_storage, deckId, '');
    const edits = mergeJournalEdits(deckId, checkpoint.edits,
      observed.filter(edit => compareHLC(edit.hlc, checkpoint.base.compactedThrough) > 0));
    const state = { base:checkpoint.base, edits };
    let deleted = new Set(snapshot.deletedCardIds ?? []);
    if (edits.length !== checkpoint.edits.length) {
      const prepared = await prepareJournal(state);
      if (_writeLocalSnapshot) await _writeLocalSnapshot(deckId, JSON.stringify(prepared.snapshot));
      db.close();
      db = prepared.db;
      snapshot = prepared.snapshot;
      deleted = prepared.deleted;
    }
    journals.set(deckId, state);
    _clock?.observe(edits.at(-1)?.hlc ?? state.base.compactedThrough);

    // Track state
    openDbs.set(deckId, db);
    deletedCards.set(deckId, deleted);
    watermarks.set(deckId, edits.length > 0
      ? edits[edits.length - 1]!.hlc
      : snapshot.compactedThrough);

    // Update registry — mark the deck as open and record the access time.
    // If the deck is already in the registry (normal case) we preserve the
    // existing counts rather than re-running the heavy getAllDeckCardCounts
    // query; the study screen doesn't show home-screen badge counts, and
    // refreshDeckCounts() is called at session end when the user goes home.
    const now = Math.floor(Date.now() / 1000);
    const existing = getDeckEntry(deckId);
    if (existing) {
      upsertDeckEntry({
        ...existing,
        hasLocalDb: true,
        isDownloaded: true,
        lastAccessedAt: now,
      });
    } else {
      // First open for this deck — query name and counts once.
      const decksResult = getAllDecks(db);
      const deckName = decksResult.success
        ? (decksResult.data.find(d => d.id === deckId)?.name ?? '')
        : '';
      const countsResult = getAllDeckCardCounts(db, now);
      const deckCounts = countsResult.success ? countsResult.data[deckId] : undefined;

      upsertDeckEntry({
        deckId,
        name: deckName,
        hasLocalDb: true,
        isDownloaded: true,
        cardCount: deckCounts?.totalCount ?? 0,
        newCount: deckCounts?.newCount ?? 0,
        learningCount: deckCounts?.learningCount ?? 0,
        reviewCount: deckCounts?.reviewCount ?? 0,
        lastAccessedAt: now,
      });
    }

    return db;
  } catch (e) {
    console.warn('[deckManager] Failed to open deck:', deckId, e);
    markDeckFailed(deckId);
    return null;
  }
}

/**
 * Remove this deck's local files only, keeping the iCloud copy intact.
 *
 * Intended for the "Remove from this device" action when a deck refuses to
 * load. The registry entry stays so the deck still appears in the list —
 * a subsequent tap re-downloads from iCloud. Other devices are unaffected.
 *
 * @param deckId - UUID of the deck.
 */
export async function removeDeckLocalOnly(deckId: string): Promise<void> {
  closeDeck(deckId);
  if (_deleteLocalSnapshot) {
    await _deleteLocalSnapshot(deckId).catch(() => {});
  }
  // Clear health cache so the next openDeck attempt is fresh.
  markDeckHealthy(deckId);
  // Mark the registry entry as not-downloaded so the UI reflects that
  // this device no longer has a local copy; tapping will re-fetch.
  const existing = getDeckEntry(deckId);
  if (existing) {
    upsertDeckEntry({ ...existing, hasLocalDb: false, isDownloaded: false });
  }
}

/**
 * Get a cached per-deck database (must already be opened).
 *
 * @param deckId - UUID of the deck.
 * @returns The cached Database, or null if not open.
 */
export function getDeckDb(deckId: string): Database | null {
  return openDbs.get(deckId) ?? null;
}

/**
 * Close a deck's database to free memory.
 *
 * @param deckId - UUID of the deck.
 */
export function closeDeck(deckId: string): void {
  const db = openDbs.get(deckId);
  if (db) {
    try { db.close(); } catch { /* already closed */ }
    openDbs.delete(deckId);
    journals.delete(deckId);
    changed(deckId);
    deletedCards.delete(deckId);
    watermarks.delete(deckId);
  }
}

/**
 * Permanently delete a deck: close its DB, soft-delete in registry, and
 * remove all local + iCloud files.
 *
 * @param deckId - UUID of the deck to delete.
 */
export async function removeDeck(deckId: string): Promise<void> {
  // 1. Close and evict from memory
  closeDeck(deckId);

  // 2. Mark deleted in registry (prevents reconcileWithICloud from re-adding it)
  const { softDeleteDeck } = await import('../sync/deckRegistry');
  softDeleteDeck(deckId);

  // 3. Delete local snapshot directory
  if (_deleteLocalSnapshot) {
    await _deleteLocalSnapshot(deckId).catch(() => {});
  }

  // 4. Delete iCloud files (best-effort — another device may still need them,
  //    but we delete on this device to free space; iCloud handles propagation)
  if (_storage) {
    // snapshot.json
    await _storage.deleteFile(`${deckId}/snapshot.json`).catch(() => {});
    // edit files
    try {
      const editFiles = await _storage.listDirectory(`${deckId}/edits`);
      await Promise.allSettled(
        editFiles.map(f => _storage!.deleteFile(`${deckId}/edits/${f}`)),
      );
    } catch {
      // Directory may not exist — ignore
    }
  }
}

// ---------------------------------------------------------------------------
// Write path: local DB + edit file
// ---------------------------------------------------------------------------

/**
 * Apply edit operations to a deck's local database AND write an edit file
 * for sync. This is the primary write function that replaces the old
 * `persistDatabase()` + `scheduleICloudBackup()` pattern.
 *
 * @param deckId - UUID of the deck.
 * @param ops    - Edit operations to apply.
 * @returns The HLC of the written edit, or null on failure.
 */
export async function applyAndSync(
  deckId: string,
  ops: EditOp[],
): Promise<string | null> {
  if (!_storage || !_clock || ops.length === 0) return null;
  const storage = _storage;
  const clock = _clock;
  const recordedOps = JSON.parse(JSON.stringify(ops)) as EditOp[];
  changed(deckId);
  const pending = localWrites.get(deckId) ?? new Set<Promise<unknown>>();
  localWrites.set(deckId, pending);
  const task = (async () => {
    const hlc = await writeEdit(storage, clock, deckId, recordedOps);
    const journal = journals.get(deckId);
    if (hlc && journal) {
      journal.edits = mergeJournalEdits(deckId, journal.edits,
        [{ v:1, hlc, deviceId:clock.deviceId, deckId, ops:recordedOps }]);
      journal.needsReplay = true;
      watermarks.set(deckId, journal.edits.at(-1)?.hlc ?? journal.base.compactedThrough);
    }
    return hlc;
  })();
  pending.add(task);
  try { return await task; }
  finally { pending.delete(task); changed(deckId); }
}

async function prepareJournal(state: JournalState): Promise<{ db: Database; snapshot: DeckSnapshot; deleted: Set<string> }> {
  if (!_SQL) throw new Error('The deck database is not ready.');
  const db = await buildDbFromSnapshot(_SQL, state.base);
  if (!db) throw new Error('The saved sync baseline could not be opened.');
  try {
    const deleted = new Set(state.base.deletedCardIds ?? []);
    if (state.edits.length && !replayEdits(db, state.edits, deleted)) throw new Error('A sync edit could not be applied. Its journal has been kept.');
    const snapshot = snapshotCurrentState(db, state.base.deckId, state.edits.at(-1)?.hlc ?? state.base.compactedThrough, deleted);
    if (!snapshot) throw new Error('The reconciled deck could not be read completely.');
    snapshot.replay = { v:1, base:state.base, edits:state.edits };
    return { db, snapshot, deleted };
  } catch (error) { db.close(); throw error; }
}

async function reconcileJournal(deckId: string, force: boolean): Promise<ReconciledJournal> {
  for (let attempt = 0; attempt < 3; attempt++) {
    await Promise.allSettled([...(localWrites.get(deckId) ?? [])]);
    const db = openDbs.get(deckId);
    const state = journals.get(deckId);
    const storage = _storage;
    if (!db || !state || !storage) return { count:0, snapshot:null };
    const revision = revisions.get(deckId) ?? 0;
    const [observed, peer] = await Promise.all([readEditsAfter(storage, deckId, ''), readSnapshot(storage, deckId)]);
    let peerEdits: EditFile[] = [];
    if (peer?.replay) {
      const checkpoint = snapshotJournal(peer);
      if (!sameJournalBase(state.base, checkpoint.base)) throw new Error('This deck has different saved sync baselines. Local study has been kept; recovery is needed before merging.');
      peerEdits = checkpoint.edits;
    }
    const edits = mergeJournalEdits(deckId, state.edits, peerEdits,
      observed.filter(edit => compareHLC(edit.hlc, state.base.compactedThrough) > 0));
    const count = edits.length - state.edits.length;
    if (!force && count === 0 && !state.needsReplay) return { count:0, snapshot:null };
    const prepared = await prepareJournal({ base:state.base, edits });
    try {
      if (openDbs.get(deckId) !== db) return { count:0, snapshot:null };
      if ((revisions.get(deckId) ?? 0) !== revision || localWrites.get(deckId)?.size) continue;
      const data = JSON.stringify(prepared.snapshot);
      // A checkpoint is durable before its canonical state replaces the live
      // cache. New writes during this await stay in their independent journal.
      if (_writeLocalSnapshot) await _writeLocalSnapshot(deckId, data);
      else await storage.writeFile(`${deckId}/snapshot.json`, data);
      if ((revisions.get(deckId) ?? 0) !== revision || localWrites.get(deckId)?.size) continue;
      if (openDbs.get(deckId) !== db) return { count:0, snapshot:null };
      const replaced = replaceDeckForReplay(db, prepared.snapshot);
      if (!replaced.success) throw new Error(replaced.error);
      journals.set(deckId, { base:state.base, edits });
      _clock?.observe(edits.at(-1)?.hlc ?? state.base.compactedThrough);
      deletedCards.set(deckId, prepared.deleted);
      watermarks.set(deckId, prepared.snapshot.compactedThrough);
      changed(deckId);
      return { count, snapshot:prepared.snapshot };
    } finally { prepared.db.close(); }
  }
  // Continuous local work takes precedence. The existing foreground retry can
  // reconcile later; never publish a checkpoint with unobserved local writes.
  throw new Error('Sync is waiting for the current card changes to finish.');
}

function queueReconciliation(deckId: string, force: boolean): Promise<ReconciledJournal> {
  const previous = reconciliation.get(deckId);
  if (previous && !force) return previous;
  const task = (async () => {
    if (previous) await previous;
    return reconcileJournal(deckId, force);
  })();
  reconciliation.set(deckId, task);
  void task.finally(() => { if (reconciliation.get(deckId) === task) reconciliation.delete(deckId); }).catch(() => {});
  return task;
}

/** Replay late or out-of-order remote edits from the retained, canonical journal.
 * @param deckId - Deck to reconcile without replacing its active connection.
 * @returns Number of newly observed identities; duplicate delivery is harmless.
 */
export async function syncDeck(deckId: string): Promise<number> {
  return (await queueReconciliation(deckId, false)).count;
}

/** Save a verified local checkpoint and mirror it without deleting any journals.
 * @param deckId - Deck to checkpoint after all observed edits were actually replayed.
 * @returns True only after the precise checkpoint was mirrored; local data remains durable on failure.
 */
export async function compactDeckEdits(deckId: string): Promise<boolean> {
  if (!_storage) return false;
  const result = await queueReconciliation(deckId, true);
  if (!result.snapshot) return false;
  return compactDeck(_storage, result.snapshot);
}

// ---------------------------------------------------------------------------
// Create a new deck (during import)
// ---------------------------------------------------------------------------

/**
 * Create a new per-deck database and initial snapshot from import data.
 *
 * @param snapshot - Full deck snapshot from the import pipeline.
 * @returns The new per-deck Database instance, or null on failure.
 */
export async function createDeckFromSnapshot(
  snapshot: DeckSnapshot,
): Promise<Database | null> {
  if (!_SQL || !_storage || !_clock) return null;

  let db: Database | null = null;
  try {
    // Build local DB
    db = await buildDbFromSnapshot(_SQL, snapshot);
    if (!db) return null;

    const initialJournal = snapshotJournal(snapshot);
    const checkpoint = { ...snapshot, replay:{ v:1 as const, base:initialJournal.base, edits:initialJournal.edits } };
    const snapshotJson = JSON.stringify(checkpoint);

    // A newly-created deck must have one durable copy before it is placed in
    // the in-memory cache or registry. Native callers configure the local
    // snapshot writer; browser callers rely on SyncStorage/localStorage.
    if (_writeLocalSnapshot) {
      // Required on native. Let failures abort creation instead of presenting
      // an in-memory deck that vanishes on the next launch.
      await _writeLocalSnapshot(snapshot.deckId, snapshotJson);

      // iCloud is secondary and may be unavailable while offline. The local
      // snapshot above is already durable, so a failed mirror is non-fatal.
      try {
        await _storage.writeFile(`${snapshot.deckId}/snapshot.json`, snapshotJson);
      } catch (e) {
        console.warn('[deckManager] Sync snapshot write failed; kept durable local copy:', e);
      }
    } else {
      // Browser storage is the only durable backend, so this write is required.
      await _storage.writeFile(`${snapshot.deckId}/snapshot.json`, snapshotJson);
    }

    // Persistence succeeded. It is now safe to expose the database and update
    // the registry so the deck appears in the UI.
    openDbs.set(snapshot.deckId, db);
    journals.set(snapshot.deckId, initialJournal);
    _clock.observe(initialJournal.edits.at(-1)?.hlc ?? initialJournal.base.compactedThrough);
    changed(snapshot.deckId);
    deletedCards.set(snapshot.deckId, new Set(snapshot.deletedCardIds ?? []));
    watermarks.set(snapshot.deckId, snapshot.compactedThrough);

    const now = Math.floor(Date.now() / 1000);
    const countsResult = getAllDeckCardCounts(db, now);
    const deckCounts = countsResult.success ? countsResult.data[snapshot.deckId] : undefined;

    upsertDeckEntry({
      deckId: snapshot.deckId,
      name: snapshot.deck.name,
      hasLocalDb: true,
      isDownloaded: true,
      cardCount: deckCounts?.totalCount ?? snapshot.cards.length,
      newCount: deckCounts?.newCount ?? snapshot.cards.length,
      learningCount: deckCounts?.learningCount ?? 0,
      reviewCount: deckCounts?.reviewCount ?? 0,
      lastAccessedAt: now,
    });

    return db;
  } catch (e) {
    console.warn('[deckManager] Failed to create deck from snapshot:', e);
    if (db && openDbs.get(snapshot.deckId) !== db) {
      try { db.close(); } catch { /* already closed */ }
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Registry persistence
// ---------------------------------------------------------------------------

/**
 * Get the initialized sql.js static module.
 * Exposed so callers (e.g. the import hook) can reuse the already-compiled
 * WASM instance instead of re-instantiating it.
 *
 * @returns The SqlJsStatic instance, or null if not yet initialized.
 */
export function getSqlStatic(): SqlJsStatic | null {
  return _SQL;
}

/**
 * Get the serialized registry JSON for persistence.
 *
 * @returns JSON string.
 */
export function getRegistryJson(): string {
  return serializeRegistry();
}

/**
 * Get the device ID.
 *
 * @returns Device ID string.
 */
export function getDeckManagerDeviceId(): string {
  return getDeviceId();
}

/**
 * Get the HLC clock instance.
 *
 * @returns HLC clock, or null if not initialized.
 */
export function getClock(): HLCClock | null {
  return _clock;
}

/**
 * Update deck name and card count in the registry.
 *
 * @param deckId    - Deck UUID.
 * @param name      - Current deck name.
 * @param cardCount - Current card count.
 */
export function updateDeckRegistryMeta(
  deckId: string,
  name: string,
  cardCount: number,
): void {
  updateDeckMeta(deckId, name, cardCount);
}

/**
 * Refresh the registry counts for an open deck by querying its DB.
 * Call after study sessions or edits to keep the home screen counts fresh.
 *
 * @param deckId - UUID of the deck.
 */
export function refreshDeckCounts(deckId: string): void {
  const db = openDbs.get(deckId);
  if (!db) return;

  const now = Math.floor(Date.now() / 1000);
  const countsResult = getAllDeckCardCounts(db, now);
  const deckCounts = countsResult.success ? countsResult.data[deckId] : undefined;

  const decksResult = getAllDecks(db);
  const deckName = decksResult.success
    ? (decksResult.data.find(d => d.id === deckId)?.name ?? '')
    : '';

  if (deckCounts) {
    updateDeckMeta(deckId, deckName, deckCounts.totalCount, {
      newCount: deckCounts.newCount,
      learningCount: deckCounts.learningCount,
      reviewCount: deckCounts.reviewCount,
    });
  }
}

/**
 * Flush any pending edit files that were queued while iCloud was unavailable.
 *
 * @returns Number of edits flushed.
 */
export async function flushPendingSync(): Promise<number> {
  if (!_storage) return 0;
  return flushPendingEdits(_storage);
}

// ---------------------------------------------------------------------------
// Global tag catalog (pass-through to deckRegistry)
// ---------------------------------------------------------------------------

export {
  getAllGlobalTags,
  upsertGlobalTag,
  deleteGlobalTag,
  renameGlobalTag,
  mergeTagsIntoGlobal,
};

// ---------------------------------------------------------------------------
// Internal: build a Database from a DeckSnapshot
// ---------------------------------------------------------------------------

/** Yield control to the browser event loop, allowing UI updates between heavy batches. */
function yieldToEventLoop(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

/** Number of rows to insert before yielding to the event loop during hydration. */
const HYDRATION_BATCH_SIZE = 500;

/**
 * Create a new sql.js Database and populate it from a DeckSnapshot.
 * Yields to the event loop every {@link HYDRATION_BATCH_SIZE} rows so the UI
 * remains responsive during large-deck hydration.
 *
 * @param SQL      - sql.js static module.
 * @param snapshot - Deck snapshot to hydrate from.
 * @returns Populated Database instance, or null on failure.
 */
async function buildDbFromSnapshot(
  SQL: SqlJsStatic,
  snapshot: DeckSnapshot,
): Promise<Database | null> {
  // Structural validation before we touch the DB. A snapshot that parses as
  // JSON but is missing required arrays would throw deep in the hydration
  // loops; catching it up front yields a clearer error and guarantees the
  // DB we return either has every expected row or is rolled back.
  if (!validateSnapshotShape(snapshot)) {
    console.warn('[deckManager] Snapshot failed structural validation:', snapshot.deckId);
    return null;
  }

  try {
    const db = new SQL.Database();
    db.run(ENABLE_FOREIGN_KEYS);

    // Create schema
    for (const ddl of ALL_TABLES) {
      db.run(ddl);
    }
    runMigrations(db);

    // Populate from snapshot in a single transaction.
    // The DB is brand-new and not yet in openDbs, so yielding mid-transaction
    // is safe — no other code holds a reference to this DB instance.
    const txn = beginTransaction(db);
    if (!txn.success) return null;

    try {
      // Insert helpers return { success, error } instead of throwing. Without
      // this check a row failure would silently skip and we'd commit a partial
      // deck — exactly the "half-imported" state we're fixing. Escalate any
      // insert failure to an exception so the outer catch rolls back.
      const must = <T>(result: { success: true; data: T } | { success: false; error: string }, what: string): T => {
        if (!result.success) throw new Error(`${what}: ${result.error}`);
        return result.data;
      };

      must(insertDeck(db, snapshot.deck), 'insertDeck');

      for (const nt of snapshot.noteTypes) {
        must(insertNoteType(db, nt), 'insertNoteType');
      }

      for (let i = 0; i < snapshot.notes.length; i++) {
        must(insertNote(db, snapshot.notes[i]!), 'insertNote');
        if ((i + 1) % HYDRATION_BATCH_SIZE === 0) await yieldToEventLoop();
      }

      for (let i = 0; i < snapshot.cards.length; i++) {
        must(insertCard(db, snapshot.cards[i]!), 'insertCard');
        if ((i + 1) % HYDRATION_BATCH_SIZE === 0) await yieldToEventLoop();
      }

      for (let i = 0; i < snapshot.cardStates.length; i++) {
        must(setCardState(db, snapshot.cardStates[i]!), 'setCardState');
        if ((i + 1) % HYDRATION_BATCH_SIZE === 0) await yieldToEventLoop();
      }

      for (let i = 0; i < snapshot.reviewLogs.length; i++) {
        const log = snapshot.reviewLogs[i]!;
        must(insertReviewLog(db, {
          id: log.id,
          cardId: log.cardId,
          rating: log.rating,
          reviewedAt: log.reviewedAt,
          elapsed: log.elapsed,
          scheduledDays: log.scheduledDays,
        }), 'insertReviewLog');
        if ((i + 1) % HYDRATION_BATCH_SIZE === 0) await yieldToEventLoop();
      }

      // Deck settings
      if (snapshot.settings) {
        const s = snapshot.settings;
        db.run(
          `INSERT OR REPLACE INTO deck_settings
           (deck_id, new_cards_per_day, max_reviews_per_day, again_steps,
            graduating_interval, easy_interval, max_interval, leech_threshold,
            desired_retention)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            s.deckId, s.newCardsPerDay, s.maxReviewsPerDay,
            JSON.stringify(s.againSteps), s.graduatingInterval,
            s.easyInterval, s.maxInterval, s.leechThreshold,
            s.desiredRetention,
          ],
        );
      }

      for (const tag of snapshot.tags) {
        db.run(
          `INSERT OR REPLACE INTO tag_colors (tag, color, created_at)
           VALUES (?, ?, ?)`,
          [tag.tag, tag.color, Math.floor(Date.now() / 1000)],
        );
      }

      for (const tag of snapshot.deckTags) {
        db.run(
          `INSERT OR IGNORE INTO deck_tags (deck_id, tag, created_at)
           VALUES (?, ?, ?)`,
          [snapshot.deckId, tag, Math.floor(Date.now() / 1000)],
        );
      }

      commitTransaction(db);
      return db;
    } catch (e) {
      console.warn('[deckManager] Failed to populate DB from snapshot:', e);
      try { db.run('ROLLBACK'); } catch { /* ignore */ }
      try { db.close(); } catch { /* ignore */ }
      return null;
    }
  } catch (e) {
    console.warn('[deckManager] Failed to create DB:', e);
    return null;
  }
}

/**
 * Read + parse this deck's local snapshot if it exists. Returns null if no
 * local snapshot is present or if the file doesn't parse as JSON. Structural
 * validation is left to buildDbFromSnapshot so the caller can distinguish
 * "no local copy" from "local copy is bad" and trigger a silent self-heal.
 */
async function tryReadLocalSnapshot(deckId: string): Promise<DeckSnapshot | null> {
  if (!_readLocalSnapshot) return null;
  const raw = await _readLocalSnapshot(deckId);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DeckSnapshot;
  } catch {
    return null;
  }
}

/**
 * Minimum structural check on a deck snapshot before we try to hydrate it.
 * We don't validate every field — that's what the JSON schema in types.ts
 * documents — but we catch the cases that would otherwise cause cryptic
 * failures deep in the insert loops: missing required arrays or a missing
 * deck object.
 */
function validateSnapshotShape(snapshot: DeckSnapshot | undefined | null): boolean {
  if (!snapshot || typeof snapshot !== 'object') return false;
  if (snapshot.v !== 1) return false;
  if (!snapshot.deck || typeof snapshot.deck !== 'object') return false;
  if (!Array.isArray(snapshot.noteTypes)) return false;
  if (!Array.isArray(snapshot.notes)) return false;
  if (!Array.isArray(snapshot.cards)) return false;
  if (!Array.isArray(snapshot.cardStates)) return false;
  if (!Array.isArray(snapshot.reviewLogs)) return false;
  if (!Array.isArray(snapshot.tags)) return false;
  if (!Array.isArray(snapshot.deckTags)) return false;
  return true;
}
