/**
 * Welcome to Kit — default deck seeded when the user has no decks.
 *
 * Contains cat-themed cards with inline SVG pixel art and a synthetic
 * meow audio clip to showcase Kit's features (images, audio, study flow).
 */

import type { Database } from 'sql.js';
import { v4 as uuidv4 } from 'uuid';
import {
  insertCard,
  insertDeck,
  insertMedia,
  beginTransaction,
  commitTransaction,
  rollbackTransaction,
} from './queries';
import type { Card, Deck, Media } from '../../types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WELCOME_DECK_ID = 'welcome-kit-00000000-0000-0000-0000-000000000001';

// ---------------------------------------------------------------------------
// Inline SVG pixel-art cats
// ---------------------------------------------------------------------------

/** Orange tabby kitten — 12x12 pixel grid rendered as SVG. */
const ORANGE_CAT_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120" style="display:block;margin:12px auto">
  <!-- Ears -->
  <rect x="20" y="0" width="10" height="10" fill="#F97316"/>
  <rect x="30" y="0" width="10" height="10" fill="#F97316"/>
  <rect x="70" y="0" width="10" height="10" fill="#F97316"/>
  <rect x="80" y="0" width="10" height="10" fill="#F97316"/>
  <!-- Head -->
  <rect x="10" y="10" width="10" height="10" fill="#F97316"/>
  <rect x="20" y="10" width="10" height="10" fill="#FB923C"/>
  <rect x="30" y="10" width="10" height="10" fill="#FB923C"/>
  <rect x="40" y="10" width="10" height="10" fill="#FB923C"/>
  <rect x="50" y="10" width="10" height="10" fill="#FB923C"/>
  <rect x="60" y="10" width="10" height="10" fill="#FB923C"/>
  <rect x="70" y="10" width="10" height="10" fill="#FB923C"/>
  <rect x="80" y="10" width="10" height="10" fill="#F97316"/>
  <!-- Face row 1 -->
  <rect x="10" y="20" width="10" height="10" fill="#FB923C"/>
  <rect x="20" y="20" width="10" height="10" fill="#FB923C"/>
  <rect x="30" y="20" width="10" height="10" fill="#1E293B"/>
  <rect x="40" y="20" width="10" height="10" fill="#FB923C"/>
  <rect x="50" y="20" width="10" height="10" fill="#FB923C"/>
  <rect x="60" y="20" width="10" height="10" fill="#1E293B"/>
  <rect x="70" y="20" width="10" height="10" fill="#FB923C"/>
  <rect x="80" y="20" width="10" height="10" fill="#FB923C"/>
  <!-- Face row 2 (nose) -->
  <rect x="10" y="30" width="10" height="10" fill="#FB923C"/>
  <rect x="20" y="30" width="10" height="10" fill="#FB923C"/>
  <rect x="30" y="30" width="10" height="10" fill="#FB923C"/>
  <rect x="40" y="30" width="10" height="10" fill="#FCA5A5"/>
  <rect x="50" y="30" width="10" height="10" fill="#FCA5A5"/>
  <rect x="60" y="30" width="10" height="10" fill="#FB923C"/>
  <rect x="70" y="30" width="10" height="10" fill="#FB923C"/>
  <rect x="80" y="30" width="10" height="10" fill="#FB923C"/>
  <!-- Body -->
  <rect x="20" y="40" width="10" height="10" fill="#F97316"/>
  <rect x="30" y="40" width="10" height="10" fill="#FB923C"/>
  <rect x="40" y="40" width="10" height="10" fill="#FEFCE8"/>
  <rect x="50" y="40" width="10" height="10" fill="#FEFCE8"/>
  <rect x="60" y="40" width="10" height="10" fill="#FB923C"/>
  <rect x="70" y="40" width="10" height="10" fill="#F97316"/>
  <rect x="20" y="50" width="10" height="10" fill="#F97316"/>
  <rect x="30" y="50" width="10" height="10" fill="#FB923C"/>
  <rect x="40" y="50" width="10" height="10" fill="#FEFCE8"/>
  <rect x="50" y="50" width="10" height="10" fill="#FEFCE8"/>
  <rect x="60" y="50" width="10" height="10" fill="#FB923C"/>
  <rect x="70" y="50" width="10" height="10" fill="#F97316"/>
  <rect x="20" y="60" width="10" height="10" fill="#F97316"/>
  <rect x="30" y="60" width="10" height="10" fill="#FB923C"/>
  <rect x="40" y="60" width="10" height="10" fill="#FB923C"/>
  <rect x="50" y="60" width="10" height="10" fill="#FB923C"/>
  <rect x="60" y="60" width="10" height="10" fill="#FB923C"/>
  <rect x="70" y="60" width="10" height="10" fill="#F97316"/>
  <!-- Legs -->
  <rect x="20" y="70" width="10" height="10" fill="#F97316"/>
  <rect x="30" y="70" width="10" height="10" fill="#F97316"/>
  <rect x="60" y="70" width="10" height="10" fill="#F97316"/>
  <rect x="70" y="70" width="10" height="10" fill="#F97316"/>
  <!-- Paws -->
  <rect x="20" y="80" width="10" height="10" fill="#FEFCE8"/>
  <rect x="30" y="80" width="10" height="10" fill="#FEFCE8"/>
  <rect x="60" y="80" width="10" height="10" fill="#FEFCE8"/>
  <rect x="70" y="80" width="10" height="10" fill="#FEFCE8"/>
  <!-- Tail -->
  <rect x="80" y="50" width="10" height="10" fill="#F97316"/>
  <rect x="90" y="40" width="10" height="10" fill="#F97316"/>
  <rect x="100" y="30" width="10" height="10" fill="#F97316"/>
</svg>`;

/** Black cat silhouette — 12x12 pixel grid. */
const BLACK_CAT_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120" style="display:block;margin:12px auto">
  <!-- Ears -->
  <rect x="20" y="0" width="10" height="10" fill="#374151"/>
  <rect x="80" y="0" width="10" height="10" fill="#374151"/>
  <rect x="10" y="10" width="10" height="10" fill="#374151"/>
  <rect x="20" y="10" width="10" height="10" fill="#1F2937"/>
  <rect x="80" y="10" width="10" height="10" fill="#1F2937"/>
  <rect x="90" y="10" width="10" height="10" fill="#374151"/>
  <!-- Head -->
  <rect x="10" y="20" width="10" height="10" fill="#1F2937"/>
  <rect x="20" y="20" width="10" height="10" fill="#1F2937"/>
  <rect x="30" y="20" width="10" height="10" fill="#1F2937"/>
  <rect x="40" y="20" width="10" height="10" fill="#1F2937"/>
  <rect x="50" y="20" width="10" height="10" fill="#1F2937"/>
  <rect x="60" y="20" width="10" height="10" fill="#1F2937"/>
  <rect x="70" y="20" width="10" height="10" fill="#1F2937"/>
  <rect x="80" y="20" width="10" height="10" fill="#1F2937"/>
  <!-- Eyes -->
  <rect x="10" y="30" width="10" height="10" fill="#1F2937"/>
  <rect x="20" y="30" width="10" height="10" fill="#1F2937"/>
  <rect x="30" y="30" width="10" height="10" fill="#FBBF24"/>
  <rect x="40" y="30" width="10" height="10" fill="#1F2937"/>
  <rect x="50" y="30" width="10" height="10" fill="#1F2937"/>
  <rect x="60" y="30" width="10" height="10" fill="#FBBF24"/>
  <rect x="70" y="30" width="10" height="10" fill="#1F2937"/>
  <rect x="80" y="30" width="10" height="10" fill="#1F2937"/>
  <!-- Nose -->
  <rect x="20" y="40" width="10" height="10" fill="#1F2937"/>
  <rect x="30" y="40" width="10" height="10" fill="#1F2937"/>
  <rect x="40" y="40" width="10" height="10" fill="#1F2937"/>
  <rect x="50" y="40" width="10" height="10" fill="#FCA5A5"/>
  <rect x="60" y="40" width="10" height="10" fill="#1F2937"/>
  <rect x="70" y="40" width="10" height="10" fill="#1F2937"/>
  <!-- Body -->
  <rect x="20" y="50" width="10" height="10" fill="#1F2937"/>
  <rect x="30" y="50" width="10" height="10" fill="#374151"/>
  <rect x="40" y="50" width="10" height="10" fill="#374151"/>
  <rect x="50" y="50" width="10" height="10" fill="#374151"/>
  <rect x="60" y="50" width="10" height="10" fill="#374151"/>
  <rect x="70" y="50" width="10" height="10" fill="#1F2937"/>
  <rect x="20" y="60" width="10" height="10" fill="#1F2937"/>
  <rect x="30" y="60" width="10" height="10" fill="#374151"/>
  <rect x="40" y="60" width="10" height="10" fill="#374151"/>
  <rect x="50" y="60" width="10" height="10" fill="#374151"/>
  <rect x="60" y="60" width="10" height="10" fill="#374151"/>
  <rect x="70" y="60" width="10" height="10" fill="#1F2937"/>
  <!-- Legs -->
  <rect x="20" y="70" width="10" height="10" fill="#1F2937"/>
  <rect x="30" y="70" width="10" height="10" fill="#1F2937"/>
  <rect x="60" y="70" width="10" height="10" fill="#1F2937"/>
  <rect x="70" y="70" width="10" height="10" fill="#1F2937"/>
  <!-- Tail -->
  <rect x="80" y="50" width="10" height="10" fill="#374151"/>
  <rect x="90" y="40" width="10" height="10" fill="#374151"/>
  <rect x="100" y="30" width="10" height="10" fill="#374151"/>
  <rect x="100" y="20" width="10" height="10" fill="#374151"/>
</svg>`;

/** Calico cat — 12x12 pixel grid. */
const CALICO_CAT_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 100" width="120" height="100" style="display:block;margin:12px auto">
  <!-- Ears -->
  <rect x="10" y="0" width="10" height="10" fill="#F97316"/>
  <rect x="20" y="0" width="10" height="10" fill="#FEFCE8"/>
  <rect x="70" y="0" width="10" height="10" fill="#1F2937"/>
  <rect x="80" y="0" width="10" height="10" fill="#374151"/>
  <!-- Head -->
  <rect x="10" y="10" width="10" height="10" fill="#FEFCE8"/>
  <rect x="20" y="10" width="10" height="10" fill="#F97316"/>
  <rect x="30" y="10" width="10" height="10" fill="#FEFCE8"/>
  <rect x="40" y="10" width="10" height="10" fill="#FEFCE8"/>
  <rect x="50" y="10" width="10" height="10" fill="#1F2937"/>
  <rect x="60" y="10" width="10" height="10" fill="#FEFCE8"/>
  <rect x="70" y="10" width="10" height="10" fill="#1F2937"/>
  <rect x="80" y="10" width="10" height="10" fill="#FEFCE8"/>
  <!-- Eyes -->
  <rect x="10" y="20" width="10" height="10" fill="#FEFCE8"/>
  <rect x="20" y="20" width="10" height="10" fill="#34D399"/>
  <rect x="30" y="20" width="10" height="10" fill="#F97316"/>
  <rect x="40" y="20" width="10" height="10" fill="#FEFCE8"/>
  <rect x="50" y="20" width="10" height="10" fill="#1F2937"/>
  <rect x="60" y="20" width="10" height="10" fill="#34D399"/>
  <rect x="70" y="20" width="10" height="10" fill="#FEFCE8"/>
  <rect x="80" y="20" width="10" height="10" fill="#FEFCE8"/>
  <!-- Nose row -->
  <rect x="20" y="30" width="10" height="10" fill="#FEFCE8"/>
  <rect x="30" y="30" width="10" height="10" fill="#FEFCE8"/>
  <rect x="40" y="30" width="10" height="10" fill="#FCA5A5"/>
  <rect x="50" y="30" width="10" height="10" fill="#FEFCE8"/>
  <rect x="60" y="30" width="10" height="10" fill="#FEFCE8"/>
  <rect x="70" y="30" width="10" height="10" fill="#FEFCE8"/>
  <!-- Body -->
  <rect x="20" y="40" width="10" height="10" fill="#F97316"/>
  <rect x="30" y="40" width="10" height="10" fill="#FEFCE8"/>
  <rect x="40" y="40" width="10" height="10" fill="#FEFCE8"/>
  <rect x="50" y="40" width="10" height="10" fill="#1F2937"/>
  <rect x="60" y="40" width="10" height="10" fill="#FEFCE8"/>
  <rect x="70" y="40" width="10" height="10" fill="#F97316"/>
  <rect x="20" y="50" width="10" height="10" fill="#FEFCE8"/>
  <rect x="30" y="50" width="10" height="10" fill="#1F2937"/>
  <rect x="40" y="50" width="10" height="10" fill="#FEFCE8"/>
  <rect x="50" y="50" width="10" height="10" fill="#F97316"/>
  <rect x="60" y="50" width="10" height="10" fill="#FEFCE8"/>
  <rect x="70" y="50" width="10" height="10" fill="#1F2937"/>
  <!-- Legs -->
  <rect x="20" y="60" width="10" height="10" fill="#FEFCE8"/>
  <rect x="30" y="60" width="10" height="10" fill="#FEFCE8"/>
  <rect x="60" y="60" width="10" height="10" fill="#FEFCE8"/>
  <rect x="70" y="60" width="10" height="10" fill="#FEFCE8"/>
  <!-- Tail -->
  <rect x="80" y="40" width="10" height="10" fill="#F97316"/>
  <rect x="90" y="30" width="10" height="10" fill="#1F2937"/>
  <rect x="100" y="20" width="10" height="10" fill="#F97316"/>
</svg>`;

// ---------------------------------------------------------------------------
// Synthetic meow audio (base64-encoded WAV, ~0.4s, 8kHz mono)
// Generated programmatically: two-tone chirp with harmonics.
// ---------------------------------------------------------------------------

const MEOW_WAV_BASE64 = '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';

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
        ${ORANGE_CAT_SVG}
        <p style="font-weight:600;margin-top:12px;font-size:1.1em">Who is Kit?</p>
      </div>
    `,
    back: `
      <div style="text-align:center">
        ${ORANGE_CAT_SVG}
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
        <strong style="color:#EF4444">Again</strong> — forgot it completely<br>
        <strong style="color:#F59E0B">Hard</strong> — recalled with difficulty<br>
        <strong style="color:#22C55E">Good</strong> — recalled correctly<br>
        <strong style="color:#3B82F6">Easy</strong> — knew it instantly
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
        ${BLACK_CAT_SVG}
        <p style="font-weight:600;margin-top:8px">What breed is famous for being all black with golden eyes?</p>
      </div>
    `,
    back: `
      <div style="text-align:center">
        ${BLACK_CAT_SVG}
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

  // Card 4: Cat fact with meow audio
  {
    front: `
      <div style="text-align:center">
        <p style="font-size:2em;margin-bottom:8px">🔊</p>
        <p style="font-weight:600">What sound does a cat make?</p>
        <p style="font-size:0.85em;margin-top:6px;opacity:0.6">Tap play to hear it!</p>
        <audio src="meow.wav" controls style="margin:12px auto;display:block;max-width:200px;height:40px"></audio>
      </div>
    `,
    back: `
      <div style="text-align:center">
        <audio src="meow.wav" controls style="margin:8px auto;display:block;max-width:200px;height:40px"></audio>
        <p style="font-weight:600;margin-bottom:8px">Meow!</p>
      </div>
      <p style="font-size:0.9em;line-height:1.6">
        Adult cats primarily meow to communicate with <strong>humans</strong>, not
        other cats. Between themselves, cats use body language, scent, and hissing.
        Kittens meow to get their mother's attention.
      </p>
      <p style="font-size:0.85em;line-height:1.6;margin-top:8px;opacity:0.7">
        Kit supports audio cards — great for language learning!
      </p>
    `,
    tags: ['welcome', 'cats', 'audio'],
  },

  // Card 5: Calico cats
  {
    front: `
      <div style="text-align:center">
        ${CALICO_CAT_SVG}
        <p style="font-weight:600;margin-top:8px">Why are almost all calico cats female?</p>
      </div>
    `,
    back: `
      <div style="text-align:center">
        ${CALICO_CAT_SVG}
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
        Tap <strong>Import Deck</strong> on the home screen to get started.
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
 * Check whether the welcome deck has already been seeded.
 *
 * @param db - Initialised sql.js Database.
 * @returns True if the welcome deck exists.
 */
export function hasWelcomeDeck(db: Database): boolean {
  try {
    const result = db.exec('SELECT id FROM decks WHERE id = ?', [WELCOME_DECK_ID]);
    return (result[0]?.values?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

/**
 * Seed the "Welcome to Kit" deck with cat-themed cards and a meow audio clip.
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

    // Insert meow audio as media blob
    const binaryStr = atob(MEOW_WAV_BASE64);
    const audioBytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      audioBytes[i] = binaryStr.charCodeAt(i);
    }

    const media: Media = {
      id: uuidv4(),
      deckId: WELCOME_DECK_ID,
      filename: 'meow.wav',
      data: audioBytes,
      mimeType: 'audio/wav',
      createdAt: now,
    };
    const mediaResult = insertMedia(db, media);
    if (!mediaResult.success) {
      rollbackTransaction(db);
      return mediaResult;
    }

    commitTransaction(db);

    return { success: true, deckId: WELCOME_DECK_ID };
  } catch (e) {
    try { rollbackTransaction(db); } catch { /* ignore */ }
    return { success: false, error: String(e) };
  }
}
