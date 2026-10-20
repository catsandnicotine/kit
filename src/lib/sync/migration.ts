/**
 * migration — converts the monolithic kit.db to per-deck snapshots.
 *
 * On first launch after the architecture update, this module:
 *   1. Opens the existing monolithic database.
 *   2. For each deck, builds a DeckSnapshot with all data.
 *   3. Writes every snapshot to durable local or sync storage.
 *   4. Updates the deck registry.
 *   5. Renames kit.db to kit.db.migrated as a safety backup.
 *
 * Non-destructive: registry entries are committed only after every deck has a
 * durable snapshot. The caller must keep the monolith when this function
 * throws.
 */

import type { Database, SqlJsStatic } from 'sql.js';
import type { SyncStorage } from './syncStorage';
import type { DeckSnapshot, SyncDeckSettings } from './types';
import { formatHLC } from './hlc';
import { upsertDeckEntry } from './deckRegistry';
import {
  getAllDecks,
  getCardsByDeck,
  getCardStatesByDeck,
  getReviewLogsByDeck,
  getNotesByDeck,
  getNoteTypesByDeck,
  getDeckSettings,
  getTagsForDeck,
} from '../db/queries';
import { ALL_TABLES, ENABLE_FOREIGN_KEYS } from '../db';
import { runMigrations } from '../db/migrations';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check whether the monolithic database needs migration.
 *
 * @param hasMonolithicDb - Whether kit.db exists on disk.
 * @param hasRegistry     - Whether deck_registry.json exists.
 * @returns True if migration should be attempted.
 */
export function needsMigration(
  hasMonolithicDb: boolean,
  hasRegistry: boolean,
): boolean {
  return hasMonolithicDb && !hasRegistry;
}

/**
 * Migrate the monolithic database to per-deck snapshots.
 *
 * @param SQL      - sql.js static module.
 * @param dbData   - Raw bytes of the monolithic kit.db.
 * @param storage  - Sync storage backend (iCloud or browser).
 * @param deviceId - Device identifier for the HLC.
 * @param writeLocalSnapshot  - Required native on-device snapshot writer.
 * @param deleteLocalSnapshot - Removes staged local snapshots after failure.
 * @returns Number of decks successfully migrated.
 */
export async function migrateMonolithicDb(
  SQL: SqlJsStatic,
  dbData: Uint8Array,
  storage: SyncStorage,
  deviceId: string,
  writeLocalSnapshot?: (deckId: string, data: string) => Promise<void>,
  deleteLocalSnapshot?: (deckId: string) => Promise<void>,
): Promise<number> {
  const db = new SQL.Database(dbData);
  const stagedLocalDeckIds: string[] = [];
  const stagedSyncPaths: string[] = [];

  try {
    db.run(ENABLE_FOREIGN_KEYS);

    // Ensure schema is up to date
    for (const ddl of ALL_TABLES) {
      db.run(ddl);
    }
    runMigrations(db);

    const decksResult = getAllDecks(db);
    if (!decksResult.success) {
      throw new Error(`Could not read decks from the legacy database: ${decksResult.error}`);
    }

    const hlc = formatHLC(Date.now(), deviceId.slice(0, 8), 0);
    const snapshots = decksResult.data.map(deck => {
      const snapshot = buildSnapshotFromMonolith(db, deck.id, hlc);
      if (!snapshot) {
        throw new Error(`Could not build a complete snapshot for legacy deck "${deck.name}".`);
      }
      return { deck, snapshot, data: JSON.stringify(snapshot) };
    });

    // Persist every required local snapshot before attempting any iCloud
    // mirrors. This prevents a local disk failure on a later deck from leaving
    // an earlier deck discoverable through sync as a partial migration.
    if (writeLocalSnapshot) {
      for (const { deck, data } of snapshots) {
        await writeLocalSnapshot(deck.id, data);
        stagedLocalDeckIds.push(deck.id);
      }
    }

    // With durable native snapshots, sync is best-effort and may catch up
    // later. Without a local writer (browser), sync storage is the required
    // durable backend and every write must succeed.
    for (const { deck, data } of snapshots) {
      const syncPath = `${deck.id}/snapshot.json`;
      try {
        await storage.writeFile(syncPath, data);
        stagedSyncPaths.push(syncPath);
      } catch (e) {
        if (!writeLocalSnapshot) {
          throw new Error(`Could not persist legacy deck "${deck.name}".`, { cause: e });
        }
        // Native migration remains safe while offline because the required
        // on-device snapshot committed above. iCloud can catch up later.
        console.warn('[migration] Sync snapshot unavailable; kept durable local copy:', deck.id, e);
      }
    }

    // All snapshots are durable. Only now is it safe to commit the complete
    // registry; never expose or persist a partially migrated deck list.
    const now = Math.floor(Date.now() / 1000);
    for (const { deck, snapshot } of snapshots) {
      upsertDeckEntry({
        deckId: deck.id,
        name: deck.name,
        hasLocalDb: writeLocalSnapshot !== undefined,
        isDownloaded: true,
        cardCount: snapshot.cards.length,
        lastAccessedAt: now,
      });
    }

    return snapshots.length;
  } catch (e) {
    // Do not leave a failed sync-only migration discoverable as a partial deck
    // list. Native staged snapshots are also removed when the caller supplies
    // the matching cleanup callback; the monolith remains authoritative.
    await Promise.allSettled(stagedSyncPaths.map(path => storage.deleteFile(path)));
    if (deleteLocalSnapshot) {
      await Promise.allSettled(stagedLocalDeckIds.map(deckId => deleteLocalSnapshot(deckId)));
    }
    throw e;
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

/**
 * Build a DeckSnapshot from the monolithic database for one deck.
 *
 * @param db     - Open monolithic database.
 * @param deckId - UUID of the deck to extract.
 * @param hlc    - HLC string for the snapshot's compactedThrough field.
 * @returns DeckSnapshot, or null on failure.
 */
function buildSnapshotFromMonolith(
  db: Database,
  deckId: string,
  hlc: string,
): DeckSnapshot | null {
  const decksResult = getAllDecks(db);
  if (!decksResult.success) return null;
  const deck = decksResult.data.find(d => d.id === deckId);
  if (!deck) return null;

  const cardsResult = getCardsByDeck(db, deckId);
  if (!cardsResult.success) return null;

  const statesResult = getCardStatesByDeck(db, deckId);
  if (!statesResult.success) return null;

  const logsResult = getReviewLogsByDeck(db, deckId);
  if (!logsResult.success) return null;

  const notesResult = getNotesByDeck(db, deckId);
  if (!notesResult.success) return null;

  const noteTypesResult = getNoteTypesByDeck(db, deckId);
  if (!noteTypesResult.success) return null;

  const settingsResult = getDeckSettings(db, deckId);
  const settings = settingsResult.success ? settingsResult.data : null;

  const tagsResult = getTagsForDeck(db, deckId);
  const tags = tagsResult.success ? tagsResult.data : [];

  const syncSettings: SyncDeckSettings = {
    deckId,
    newCardsPerDay: settings?.newCardsPerDay ?? 20,
    maxReviewsPerDay: settings?.maxReviewsPerDay ?? 200,
    againSteps: settings?.againSteps ?? [1, 10],
    graduatingInterval: settings?.graduatingInterval ?? 1,
    easyInterval: settings?.easyInterval ?? 4,
    maxInterval: settings?.maxInterval ?? 365,
    leechThreshold: settings?.leechThreshold ?? 8,
    desiredRetention: settings?.desiredRetention ?? 0.9,
  };

  return {
    v: 1,
    deckId,
    compactedThrough: hlc,
    mergedEditFiles: [],
    deck,
    settings: syncSettings,
    noteTypes: noteTypesResult.data,
    notes: notesResult.data,
    cards: cardsResult.data,
    cardStates: statesResult.data,
    reviewLogs: logsResult.data.map(log => ({
      id: log.id,
      cardId: log.cardId,
      rating: log.rating,
      reviewedAt: log.reviewedAt,
      elapsed: log.elapsed,
      scheduledDays: log.scheduledDays,
    })),
    tags: tags.map(t => ({ tag: t.tag, color: t.color ?? '' })),
    deckTags: tags.map(t => t.tag),
    deletedCardIds: [],
  };
}
