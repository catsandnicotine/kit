/**
 * An optional, concise guide to the controls used while studying.
 * Existing decks are never replaced when this content changes.
 */

import type { Database } from 'sql.js';
import { v4 as uuidv4 } from 'uuid';
import type { DeckSnapshot } from '../sync/types';
import { createEmptyDeckSnapshot } from './deckFactory';
import {
  getDeckById,
  insertCard,
  insertDeck,
  beginTransaction,
  commitTransaction,
  rollbackTransaction,
} from './queries';
import type { Card, Deck } from '../../types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const WELCOME_DECK_ID = 'welcome-kit-00000000-0000-0000-0000-000000000001';

// ---------------------------------------------------------------------------
// Card content
// ---------------------------------------------------------------------------

interface RawCard {
  front: string;
  back: string;
  tags: string[];
}

const CARDS: RawCard[] = [
  {
    front: '<p>What should you do before tapping the eye?</p>',
    back: '<p>Try to remember first.</p><p>Then tap the eye to check your answer.</p>',
    tags: ['tutorial'],
  },
  {
    front: '<p>Which rating fits what you remembered?</p>',
    back: '<p><strong>Again</strong> — forgot.<br><strong>Hard</strong> — remembered with effort.<br><strong>Good</strong> — remembered.<br><strong>Easy</strong> — remembered instantly.</p><p>Choose honestly. This sets when the card returns.</p>',
    tags: ['tutorial'],
  },
  {
    front: '<p>Want to see the question again?</p>',
    back: '<p>Tap the eye card below the choices.</p><p>The written card returns to the answer. Flipping never rates a card.</p>',
    tags: ['tutorial'],
  },
  {
    front: '<p>Study or Practice?</p>',
    back: '<p><strong>Study</strong> brings you cards that are due. Your ratings set their next review.</p><p><strong>Practice</strong> lets you go through a deck without changing its review dates.</p>',
    tags: ['tutorial'],
  },
  {
    front: '<p>How do you add your own cards?</p>',
    back: '<p>Tap <strong>+</strong> in the library.</p><p><strong>Make cards</strong> with text and photos, or <strong>Import Anki</strong> from an .apkg file.</p>',
    tags: ['tutorial'],
  },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build the tutorial deck for the active per-deck storage architecture.
 *
 * @param now - Optional Unix timestamp in seconds; uses the current time when omitted.
 * @returns A complete snapshot containing Kit's tutorial cards.
 */
export function createWelcomeDeckSnapshot(
  now = Math.floor(Date.now() / 1000),
): DeckSnapshot {
  const snapshot = createEmptyDeckSnapshot('Quick start', WELCOME_DECK_ID, now);
  snapshot.deck.description = 'Five cards to learn your way around Kit.';
  snapshot.cards = CARDS.map((raw, index) => ({
    id: `${WELCOME_DECK_ID}:card:${index + 1}`,
    deckId: WELCOME_DECK_ID,
    noteId: null,
    front: raw.front.trim(),
    back: raw.back.trim(),
    tags: [...raw.tags],
    createdAt: now,
    updatedAt: now,
  }));
  snapshot.tags = [
    { tag: 'tutorial', color: '#728a79' },
  ];
  snapshot.deckTags = snapshot.tags.map(entry => entry.tag);
  return snapshot;
}

/**
 * Check whether the welcome deck has already been seeded.
 *
 * @param db - Initialised sql.js Database.
 * @returns True if the welcome deck exists.
 */
export function hasWelcomeDeck(db: Database): boolean {
  const result = getDeckById(db, WELCOME_DECK_ID);
  return result.success && result.data !== null;
}

/**
 * Seed the optional Quick start deck.
 * Idempotent — skips if the deck already exists.
 *
 * @param db - Initialised sql.js Database with Kit schema applied.
 * @returns The deck ID on success, or an error.
 */
export function seedWelcomeDeck(
  db: Database,
): { success: true; deckId: string } | { success: false; error: string } {
  try {
    if (hasWelcomeDeck(db)) {
      return { success: true, deckId: WELCOME_DECK_ID };
    }

    const now = Math.floor(Date.now() / 1000);

    beginTransaction(db);

    // Insert deck
    const deck: Deck = {
      id: WELCOME_DECK_ID,
      name: 'Quick start',
      description: 'Five cards to learn your way around Kit.',
      createdAt: now,
      updatedAt: now,
    };
    const deckResult = insertDeck(db, deck);
    if (!deckResult.success) {
      rollbackTransaction(db);
      return deckResult;
    }

    // Insert cards
    for (const raw of CARDS) {
      const card: Card = {
        id: uuidv4(),
        deckId: WELCOME_DECK_ID,
        noteId: null,
        front: raw.front.trim(),
        back: raw.back.trim(),
        tags: raw.tags,
        createdAt: now,
        updatedAt: now,
      };
      const cardResult = insertCard(db, card);
      if (!cardResult.success) {
        rollbackTransaction(db);
        return cardResult;
      }
    }
    commitTransaction(db);

    return { success: true, deckId: WELCOME_DECK_ID };
  } catch (e) {
    try { rollbackTransaction(db); } catch { /* ignore */ }
    return { success: false, error: String(e) };
  }
}
