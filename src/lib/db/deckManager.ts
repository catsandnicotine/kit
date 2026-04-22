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
import type { DeckSnapshot, EditOp } from '../sync/types';
import { createHLC, type HLCClock } from '../sync/hlc';
import { writeEdit, flushPendingEdits } from '../sync/editWriter';
import { readEditsAfter, readSnapshot } from '../sync/editReader';
import { replayEdits } from '../sync/replay';
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

    if (!db || !snapshot) return null;

    // Replay any edits newer than the snapshot
    const deleted = new Set(snapshot.deletedCardIds ?? []);
    const edits = await readEditsAfter(_storage, deckId, snapshot.compactedThrough);
    if (edits.length > 0) {
      replayEdits(db, edits, deleted);
    }

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
    return null;
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

  // Write edit file to persistent storage
  const hlc = await writeEdit(_storage, _clock, deckId, ops);

  // Update watermark
  if (hlc) {
    watermarks.set(deckId, hlc);
  }

  return hlc;
}

/**
 * Sync a deck by replaying any new edits from iCloud.
 *
 * @param deckId - UUID of the deck.
 * @returns Number of new edits replayed.
 */
export async function syncDeck(deckId: string): Promise<number> {
  const db = openDbs.get(deckId);
  if (!db || !_storage) return 0;

  const watermark = watermarks.get(deckId) ?? '';
  const edits = await readEditsAfter(_storage, deckId, watermark);
  if (edits.length === 0) return 0;

  const deleted = deletedCards.get(deckId) ?? new Set<string>();
  const lastHLC = replayEdits(db, edits, deleted);
  if (lastHLC) {
    watermarks.set(deckId, lastHLC);
  }

  return edits.length;
}

/**
 * Compact a deck's edit files into a snapshot.
 * Call this after a study session ends.
 *
 * @param deckId - UUID of the deck.
 * @returns True if compaction succeeded.
 */
export async function compactDeckEdits(deckId: string): Promise<boolean> {
  const db = openDbs.get(deckId);
  if (!db || !_storage) return false;

  const deleted = deletedCards.get(deckId) ?? new Set<string>();

  // Always snapshot the current in-memory DB state so edits from this
  // session survive app restarts — even if individual edit files are lost
  // or iCloud was unavailable during the session.
  const snap = snapshotCurrentState(db, deckId, watermarks.get(deckId) ?? '', deleted);
  if (snap) {
    const snapJson = JSON.stringify(snap);
    // Write to native local storage (iOS) — awaited so the snapshot is
    // reliably on disk before the function returns. This is the primary
    // persistence path; iCloud is secondary (best-effort).
    if (_writeLocalSnapshot) {
      try { await _writeLocalSnapshot(deckId, snapJson); } catch { /* best effort */ }
    }
    // Write to sync storage (iCloud on native, localStorage in browser)
    // so the snapshot is available on next openDeck regardless of platform
    _storage.writeFile(`${deckId}/snapshot.json`, snapJson).catch(() => {});
  }

  return compactDeck(_storage, db, deckId, deleted);
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

  try {
    // Build local DB
    const db = await buildDbFromSnapshot(_SQL, snapshot);
    if (!db) return null;

    // Track state locally first — deck is usable even if iCloud write fails
    openDbs.set(snapshot.deckId, db);
    deletedCards.set(snapshot.deckId, new Set(snapshot.deletedCardIds ?? []));
    watermarks.set(snapshot.deckId, snapshot.compactedThrough);

    // Update registry so the deck appears in the UI immediately
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

    const snapshotJson = JSON.stringify(snapshot);

    // Write locally first — this is the reliable on-device copy.
    if (_writeLocalSnapshot) {
      await _writeLocalSnapshot(snapshot.deckId, snapshotJson).catch(() => {});
    }

    // Then write to iCloud for cross-device sync (best-effort).
    try {
      await _storage.writeFile(`${snapshot.deckId}/snapshot.json`, snapshotJson);
    } catch (e) {
      console.warn('[deckManager] iCloud snapshot write failed, deck available locally:', e);
    }

    return db;
  } catch (e) {
    console.warn('[deckManager] Failed to create deck from snapshot:', e);
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
