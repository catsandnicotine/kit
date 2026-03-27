/**
 * compact — merges edit files into a snapshot for a deck.
 *
 * Compaction reduces the number of edit files in iCloud (preventing
 * file accumulation) and creates a single snapshot.json that new devices
 * can use to bootstrap their local database quickly.
 *
 * Safety: only edit files older than COMPACTION_SAFETY_MS are compacted,
 * preventing races where another device is mid-write.
 */

import type { Database } from 'sql.js';
import type { DeckSnapshot, EditFile, SyncDeckSettings } from './types';
import type { SyncStorage } from './syncStorage';
import { readAllEdits } from './editReader';
import {
  getAllDecks,
  getCardsByDeck,
  getCardStatesByDeck,
  getDeckSettings,
  getReviewLogsByDeck,
  getNotesByDeck,
  getNoteTypesByDeck,
  getTagsForDeck,
} from '../db/queries';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Only compact edits older than this (ms). Prevents compaction races. */
const COMPACTION_SAFETY_MS = 2 * 60 * 1000; // 2 minutes

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compact edit files for a deck into a snapshot.
 *
 * Reads the current state from the local per-deck SQLite database (which
 * has already replayed all known edits) and writes it as snapshot.json.
 * Then deletes the compacted edit files from iCloud storage.
 *
 * @param storage         - Abstract storage backend.
 * @param db              - Local per-deck SQLite database (up to date).
 * @param deckId          - UUID of the deck to compact.
 * @param deletedCardIds  - Set of soft-deleted card IDs.
 * @returns True if compaction succeeded.
 */
export async function compactDeck(
  storage: SyncStorage,
  db: Database,
  deckId: string,
  deletedCardIds: Set<string>,
): Promise<boolean> {
  try {
    // 1. Read all edit files
    const allEdits = await readAllEdits(storage, deckId);
    if (allEdits.length === 0) return true; // Nothing to compact

    // 2. Filter to edits old enough to safely compact
    const cutoff = Date.now() - COMPACTION_SAFETY_MS;
    const compactable = filterCompactableEdits(allEdits, cutoff);
    if (compactable.length === 0) return true; // All edits too recent

    // 3. Build snapshot from current local DB state
    const snapshot = buildSnapshot(db, deckId, compactable, deletedCardIds);
    if (!snapshot) return false;

    // 4. Write snapshot atomically
    const snapshotPath = `${deckId}/snapshot.json`;
    await storage.writeFile(snapshotPath, JSON.stringify(snapshot));

    // 5. Delete compacted edit files
    for (const edit of compactable) {
      const filename = `${edit.hlc}.json`;
      try {
        await storage.deleteFile(`${deckId}/edits/${filename}`);
      } catch {
        // Best effort — file may already be deleted by another device
      }
    }

    return true;
  } catch (e) {
    console.warn('[compact] Compaction failed for deck:', deckId, e);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Filter edits to only those old enough to safely compact.
 * Uses the HLC's wall-clock component to check age.
 *
 * @param edits  - All edit files for a deck.
 * @param cutoff - Timestamp (ms) before which edits are safe to compact.
 * @returns Edits that are old enough.
 */
function filterCompactableEdits(edits: EditFile[], cutoff: number): EditFile[] {
  return edits.filter(edit => {
    // Extract wall-clock ms from HLC (first 13 chars)
    const wallMs = parseInt(edit.hlc.slice(0, 13), 10);
    return !isNaN(wallMs) && wallMs < cutoff;
  });
}

/**
 * Build a DeckSnapshot from the current local database state.
 *
 * @param db              - Local per-deck SQLite database.
 * @param deckId          - Deck UUID.
 * @param compactedEdits  - Edit files being compacted.
 * @param deletedCardIds  - Set of soft-deleted card IDs.
 * @returns A DeckSnapshot, or null on failure.
 */
function buildSnapshot(
  db: Database,
  deckId: string,
  compactedEdits: EditFile[],
  deletedCardIds: Set<string>,
): DeckSnapshot | null {
  // Read all deck data from local SQLite
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
  if (!settingsResult.success) return null;

  const tagsResult = getTagsForDeck(db, deckId);
  const tags = tagsResult.success ? tagsResult.data : [];

  const settings = settingsResult.data;
  const syncSettings: SyncDeckSettings = {
    deckId,
    newCardsPerDay: settings.newCardsPerDay,
    maxReviewsPerDay: settings.maxReviewsPerDay,
    againSteps: settings.againSteps,
    graduatingInterval: settings.graduatingInterval,
    easyInterval: settings.easyInterval,
    maxInterval: settings.maxInterval,
    leechThreshold: settings.leechThreshold,
    desiredRetention: settings.desiredRetention,
  };

  const lastEdit = compactedEdits[compactedEdits.length - 1];

  return {
    v: 1,
    deckId,
    compactedThrough: lastEdit.hlc,
    mergedEditFiles: compactedEdits.map(e => `${e.hlc}.json`),
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
    deletedCardIds: Array.from(deletedCardIds),
  };
}
