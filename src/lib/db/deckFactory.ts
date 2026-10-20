import { v4 as uuidv4 } from 'uuid';
import type { DeckSnapshot, SyncDeckSettings } from '../sync/types';
import { loadStudyPreferences } from '../studyPreferences';

/**
 * Build the default study settings for a new deck.
 *
 * @param deckId - ID of the deck that owns the settings.
 * @returns A fresh settings object using Kit's defaults.
 */
export function createDefaultDeckSettings(deckId: string): SyncDeckSettings {
  const preferences = loadStudyPreferences();
  return {
    deckId,
    newCardsPerDay: 20,
    maxReviewsPerDay: 200,
    againSteps: preferences.againSteps,
    graduatingInterval: preferences.graduatingInterval,
    easyInterval: preferences.easyInterval,
    maxInterval: 365,
    leechThreshold: 8,
    desiredRetention: preferences.desiredRetention,
  };
}

/**
 * Build a valid empty snapshot for a newly-created deck.
 *
 * @param name - User-facing deck name.
 * @param deckId - Optional stable ID; generated when omitted.
 * @param now - Optional Unix timestamp in seconds; uses the current time when omitted.
 * @returns A complete per-deck snapshot ready for DeckManager.
 */
export function createEmptyDeckSnapshot(
  name: string,
  deckId = uuidv4(),
  now = Math.floor(Date.now() / 1000),
): DeckSnapshot {
  const trimmedName = name.trim();
  if (!trimmedName) {
    throw new Error('Deck name cannot be empty.');
  }

  return {
    v: 1,
    deckId,
    compactedThrough: '',
    mergedEditFiles: [],
    deck: {
      id: deckId,
      name: trimmedName,
      description: '',
      createdAt: now,
      updatedAt: now,
    },
    settings: createDefaultDeckSettings(deckId),
    noteTypes: [],
    notes: [],
    cards: [],
    cardStates: [],
    reviewLogs: [],
    tags: [],
    deckTags: [],
    deletedCardIds: [],
  };
}
