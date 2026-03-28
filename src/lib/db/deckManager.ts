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
import { compactDeck } from '../sync/compact';
import {
  initRegistry,
  getDeviceId,
  serializeRegistry,
  upsertDeckEntry,
  getDeckEntry,
  getAllDeckEntries,
  reconcileWithICloud,
  updateDeckMeta,
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
  getCardsByDeck,
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
    // Read snapshot from iCloud
    const snapshot = await readSnapshot(_storage, deckId);
    if (!snapshot) return null;

    // Create and populate DB from snapshot
    const db = buildDbFromSnapshot(_SQL, snapshot);
    if (!db) return null;

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
      ? edits[edits.length - 1].hlc
      : snapshot.compactedThrough);

    // Update registry with detailed counts
    const decksResult = getAllDecks(db);
    const deckName = decksResult.success
      ? (decksResult.data.find(d => d.id === deckId)?.name ?? '')
      : '';
    const now = Math.floor(Date.now() / 1000);
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

  // Write edit file to iCloud (async, non-blocking for local writes)
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
    const db = buildDbFromSnapshot(_SQL, snapshot);
    if (!db) return null;

    // Write snapshot to iCloud
    const snapshotPath = `${snapshot.deckId}/snapshot.json`;
    await _storage.writeFile(snapshotPath, JSON.stringify(snapshot));

    // Track state
    openDbs.set(snapshot.deckId, db);
    deletedCards.set(snapshot.deckId, new Set(snapshot.deletedCardIds ?? []));
    watermarks.set(snapshot.deckId, snapshot.compactedThrough);

    // Update registry with detailed counts
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
    return null;
  }
}

// ---------------------------------------------------------------------------
// Registry persistence
// ---------------------------------------------------------------------------

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
// Internal: build a Database from a DeckSnapshot
// ---------------------------------------------------------------------------

/**
 * Create a new sql.js Database and populate it from a DeckSnapshot.
 *
 * @param SQL      - sql.js static module.
 * @param snapshot - Deck snapshot to hydrate from.
 * @returns Populated Database instance, or null on failure.
 */
function buildDbFromSnapshot(
  SQL: SqlJsStatic,
  snapshot: DeckSnapshot,
): Database | null {
  try {
    const db = new SQL.Database();
    db.run(ENABLE_FOREIGN_KEYS);

    // Create schema
    for (const ddl of ALL_TABLES) {
      db.run(ddl);
    }
    runMigrations(db);

    // Populate from snapshot in a single transaction
    const txn = beginTransaction(db);
    if (!txn.success) return null;

    try {
      // Deck
      insertDeck(db, snapshot.deck);

      // Note types
      for (const nt of snapshot.noteTypes) {
        insertNoteType(db, nt);
      }

      // Notes
      for (const note of snapshot.notes) {
        insertNote(db, note);
      }

      // Cards
      for (const card of snapshot.cards) {
        insertCard(db, card);
      }

      // Card states
      for (const state of snapshot.cardStates) {
        setCardState(db, state);
      }

      // Review logs
      for (const log of snapshot.reviewLogs) {
        insertReviewLog(db, {
          id: log.id,
          cardId: log.cardId,
          rating: log.rating,
          reviewedAt: log.reviewedAt,
          elapsed: log.elapsed,
          scheduledDays: log.scheduledDays,
        });
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

      // Tags
      for (const tag of snapshot.tags) {
        db.run(
          `INSERT OR REPLACE INTO tag_colors (tag, color, created_at)
           VALUES (?, ?, ?)`,
          [tag.tag, tag.color, Math.floor(Date.now() / 1000)],
        );
      }

      // Deck-tag associations
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
      return null;
    }
  } catch (e) {
    console.warn('[deckManager] Failed to create DB:', e);
    return null;
  }
}
