/**
 * Welcome to Kit — default deck seeded when the user has no decks.
 *
 * Contains cat-themed cards with inline SVG pixel art.
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
  // Card 1: Meet Kit
  {
    front: `
      <div style="text-align:center">
        <p style="font-weight:600;margin-top:12px;font-size:1.1em">Who is Kit?</p>
      </div>
    `,
    back: `
      <div style="text-align:center">
        <p style="font-weight:600;margin-bottom:8px;font-size:1.1em">Kit is your flashcard companion!</p>
      </div>
      <p style="font-size:0.9em;line-height:1.6">
        Kit uses <strong>spaced repetition</strong> (FSRS) to schedule your reviews
        at the perfect time. Cards you find easy appear less often. Cards you
        struggle with come back sooner.
      </p>
    `,
    tags: ['welcome', 'tutorial'],
  },

  // Card 2: How to study
  {
    front: `
      <div style="text-align:center">
        <p style="font-size:2.5em;margin-bottom:8px">👆</p>
        <p style="font-weight:600">How do you reveal the answer?</p>
      </div>
    `,
    back: `
      <p style="font-weight:600;margin-bottom:8px">Tap the card to flip it!</p>
      <p style="font-size:0.9em;line-height:1.6">
        After seeing the answer, rate how well you knew it:<br><br>
        <strong>Again</strong> — forgot it completely<br>
        <strong>Hard</strong> — recalled with difficulty<br>
        <strong>Good</strong> — recalled correctly<br>
        <strong>Easy</strong> — knew it instantly
      </p>
      <p style="font-size:0.85em;line-height:1.6;margin-top:8px;opacity:0.7">
        Each button shows when the card will come back. Kit learns your pace!
      </p>
    `,
    tags: ['welcome', 'tutorial'],
  },

  // Card 3: Cat breeds with image
  {
    front: `
      <div style="text-align:center">
        <p style="font-weight:600;margin-top:8px">What breed is famous for being all black with golden eyes?</p>
      </div>
    `,
    back: `
      <div style="text-align:center">
        <p style="font-weight:600;margin-bottom:8px">The Bombay cat</p>
      </div>
      <p style="font-size:0.9em;line-height:1.6">
        Bombay cats were bred to look like mini black panthers. They have sleek
        black coats, copper or golden eyes, and very affectionate personalities.
        They were first bred in Louisville, Kentucky in the 1950s.
      </p>
    `,
    tags: ['welcome', 'cats'],
  },

  // Card 5: Calico cats
  {
    front: `
      <div style="text-align:center">
        <p style="font-weight:600;margin-top:8px">Why are almost all calico cats female?</p>
      </div>
    `,
    back: `
      <div style="text-align:center">
        <p style="font-weight:600;margin-bottom:8px">It's linked to the X chromosome!</p>
      </div>
      <p style="font-size:0.9em;line-height:1.6">
        The gene for orange vs. black fur is on the <strong>X chromosome</strong>.
        To display both colours, a cat needs two X chromosomes (XX = female).
        Male calicos (XXY) are extremely rare — about 1 in 3,000.
      </p>
    `,
    tags: ['welcome', 'cats', 'science'],
  },

  // Card 6: Importing decks
  {
    front: `
      <div style="text-align:center">
        <p style="font-size:2em;margin-bottom:8px">📦</p>
        <p style="font-weight:600">How do you add your own flashcards?</p>
      </div>
    `,
    back: `
      <p style="font-weight:600;margin-bottom:8px">Import an Anki .apkg file!</p>
      <p style="font-size:0.9em;line-height:1.6">
        Kit imports <strong>.apkg</strong> files from Anki — the most popular
        flashcard format. Thousands of free decks are available online for
        languages, medicine, history, and more.
      </p>
      <p style="font-size:0.9em;line-height:1.6;margin-top:8px">
        Tap <strong>+ → Import Anki deck</strong> on the home screen to get started.
        Kit preserves images, audio, and formatting.
      </p>
    `,
    tags: ['welcome', 'tutorial'],
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
  const snapshot = createEmptyDeckSnapshot('Welcome to Kit', WELCOME_DECK_ID, now);
  snapshot.deck.description = 'Meet Kit the cat and learn how spaced repetition works!';
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
    { tag: 'welcome', color: '#8E8E93' },
    { tag: 'tutorial', color: '#3B82F6' },
    { tag: 'cats', color: '#F97316' },
    { tag: 'science', color: '#22C55E' },
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
 * Seed the "Welcome to Kit" deck with cat-themed cards.
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
      name: 'Welcome to Kit',
      description: 'Meet Kit the cat and learn how spaced repetition works!',
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
