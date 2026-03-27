/**
 * migration — converts the monolithic kit.db to per-deck snapshots.
 *
 * On first launch after the architecture update, this module:
 *   1. Opens the existing monolithic database.
 *   2. For each deck, builds a DeckSnapshot with all data.
 *   3. Writes snapshots to iCloud via SyncStorage.
 *   4. Updates the deck registry.
 *   5. Renames kit.db to kit.db.migrated as a safety backup.
 *
 * Non-destructive: if migration fails partway, the old path still works.
 */

import type { Database, SqlJsStatic } from 'sql.js';
import type { SyncStorage } from './syncStorage';
import type { DeckSnapshot, SyncDeckSettings } from './types';
import { formatHLC, generateDeviceId } from './hlc';
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
 * @returns Number of decks successfully migrated.
 */
export async function migrateMonolithicDb(
  SQL: SqlJsStatic,
  dbData: Uint8Array,
  storage: SyncStorage,
  deviceId: string,
): Promise<number> {
  // Open the monolithic DB
  const db = new SQL.Database(dbData);
  db.run(ENABLE_FOREIGN_KEYS);

  // Ensure schema is up to date
  for (const ddl of ALL_TABLES) {
    db.run(ddl);
  }
  runMigrations(db);

  const decksResult = getAllDecks(db);
  if (!decksResult.success) {
    db.close();
    return 0;
  }

  const hlc = formatHLC(Date.now(), deviceId.slice(0, 8), 0);
  let migrated = 0;

  for (const deck of decksResult.data) {
    try {
      const snapshot = buildSnapshotFromMonolith(db, deck.id, hlc);
      if (!snapshot) continue;

      // Write snapshot to iCloud
      const snapshotPath = `${deck.id}/snapshot.json`;
      await storage.writeFile(snapshotPath, JSON.stringify(snapshot));

      // Update registry
      upsertDeckEntry({
        deckId: deck.id,
        name: deck.name,
        hasLocalDb: false, // Will be built on first open
        isDownloaded: true,
        cardCount: snapshot.cards.length,
        lastAccessedAt: Math.floor(Date.now() / 1000),
      });

      migrated++;
    } catch (e) {
      console.warn('[migration] Failed to migrate deck:', deck.id, deck.name, e);
      // Continue with other decks
    }
  }

  db.close();
  return migrated;
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
    maxInterval: settings?.maxInterval ?? 36500,
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
