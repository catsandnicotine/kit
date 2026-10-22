/** Mirror a live local checkpoint without pruning source edit files.
 * Age does not prove that an offline peer received an edit.
 */

import type { Database } from 'sql.js';
import type { DeckSnapshot, EditFile, SyncDeckSettings } from './types';
import type { SyncStorage } from './syncStorage';
import {
  getAllDecks,
  getCardsByDeck,
  getCardStatesByDeck,
  getDeckSettings,
  getReviewLogsByDeck,
  getNotesByDeck,
  getNoteTypesByDeck,
  getTagsForDeck,
  getAllTagsWithCounts,
} from '../db/queries';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Mirror a live local checkpoint without claiming cloud delivery.
 * @param storage - Cloud or browser sync storage.
 * @param snapshot - Current local state, including local actions absent from the edit protocol.
 * @returns True after the local iCloud file write, retaining all source edit files.
 */
export async function compactDeck(storage: SyncStorage, snapshot: DeckSnapshot): Promise<boolean> {
  try {
    await storage.writeFile(`${snapshot.deckId}/snapshot.json`, JSON.stringify(snapshot));
    // Retain cloud edits and pending local writes. Time is not proof that an
    // offline peer received an edit; safe pruning requires acknowledgements.
    return true;
  } catch (error) {
    console.warn('[compact] Checkpoint mirror remains unavailable:', snapshot.deckId, error);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build a snapshot from the current in-memory DB state.
 * Used to persist the local snapshot at session end so edits survive
 * app restarts even when iCloud was unavailable during the session.
 *
 * @param db             - Current per-deck SQLite database (fully up-to-date).
 * @param deckId         - Deck UUID.
 * @param watermark      - HLC of the last known edit (becomes compactedThrough).
 * @param deletedCardIds - Set of soft-deleted card IDs.
 * @returns A DeckSnapshot, or null on failure.
 */
export function snapshotCurrentState(
  db: Database,
  deckId: string,
  watermark: string,
  deletedCardIds: Set<string>,
): DeckSnapshot | null {
  const snap = buildSnapshot(db, deckId, [], deletedCardIds);
  if (!snap) return null;
  return { ...snap, compactedThrough: watermark, mergedEditFiles: [] };
}

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

  const tagsResult = getAllTagsWithCounts(db, deckId);
  const deckTagsResult = getTagsForDeck(db, deckId);
  if (!tagsResult.success || !deckTagsResult.success) return null;
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
    compactedThrough: lastEdit?.hlc ?? '',
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
    deckTags: deckTagsResult.success ? deckTagsResult.data.map(t => t.tag) : [],
    deletedCardIds: Array.from(deletedCardIds),
  };
}
