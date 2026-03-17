/**
 * Anki .apkg exporter.
 *
 * Builds a valid .apkg file (ZIP archive) that can be imported by
 * Anki Desktop, AnkiMobile, and AnkiDroid.
 *
 * Structure of an .apkg:
 *   collection.anki2  — SQLite database matching Anki's schema
 *   media              — JSON object mapping numeric keys to filenames
 *   0, 1, 2 …         — raw media blobs keyed by their numeric index
 *
 * The Anki database schema (simplified, required columns only):
 *   col   — single row: id, crt, mod, scm, ver, dty, usn, ls, conf, models, decks, dconf, tags
 *   notes — id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data
 *   cards — id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data
 *   revlog — (empty — we don't export review history)
 *   graves — (empty)
 *
 * This module has ZERO imports from React, UI, or platform code.
 */

import JSZip from 'jszip';
import initSqlJs from 'sql.js';
import type { Database } from 'sql.js';
import type {
  Card,
  CardState,
  Deck,
  Note,
  NoteType,
  Result,
} from '../../types';
import {
  getCardsByDeck,
  getCardStatesByDeck,
  getDeckById,
  getMediaByDeck,
  getNotesByDeck,
  getNoteTypesByDeck,
  type MediaBlob,
} from '../db/queries';
import { getSqlJsLocator } from './parser';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Anki epoch: 2006-01-01T00:00:00Z in seconds. */
const ANKI_EPOCH = 1136073600;

/**
 * Default deck configuration JSON.
 * Anki requires at least one dconf entry keyed "1".
 */
const DEFAULT_DCONF: Record<string, unknown> = {
  '1': {
    id: 1,
    mod: 0,
    name: 'Default',
    usn: 0,
    maxTaken: 60,
    autoplay: true,
    timer: 0,
    replayq: true,
    new: {
      bury: true,
      delays: [1, 10],
      initialFactor: 2500,
      ints: [1, 4, 7],
      order: 1,
      perDay: 20,
      separate: true,
    },
    rev: {
      bury: true,
      ease4: 1.3,
      fuzz: 0.05,
      ivlFct: 1,
      maxIvl: 36500,
      minSpace: 1,
      perDay: 200,
    },
    lapse: {
      delays: [10],
      leechAction: 0,
      leechFails: 8,
      minInt: 1,
      mult: 0,
    },
  },
};

/**
 * Default collection configuration JSON.
 * Anki requires a conf blob with at minimum these keys.
 */
const DEFAULT_CONF: Record<string, unknown> = {
  activeDecks: [1],
  curDeck: 1,
  newSpread: 0,
  collapseTime: 1200,
  timeLim: 0,
  estTimes: true,
  dueCounts: true,
  curModel: null,
  nextPos: 1,
  sortType: 'noteFld',
  sortBackwards: false,
  addToCur: true,
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Export a Kit deck as a valid Anki .apkg file.
 *
 * @param kitDb  - The Kit sql.js Database instance.
 * @param deckId - UUID of the deck to export.
 * @returns A Blob containing the .apkg ZIP, or an error.
 */
export async function exportDeckAsApkg(
  kitDb: Database,
  deckId: string,
): Promise<Result<Blob>> {
  try {
    // ── 1. Fetch all data from Kit's database ─────────────────────────────
    const deckResult = getDeckById(kitDb, deckId);
    if (!deckResult.success) return deckResult;
    if (!deckResult.data) return { success: false, error: 'Deck not found.' };
    const deck = deckResult.data;

    const noteTypesResult = getNoteTypesByDeck(kitDb, deckId);
    if (!noteTypesResult.success) return noteTypesResult;
    const noteTypes = noteTypesResult.data;

    const notesResult = getNotesByDeck(kitDb, deckId);
    if (!notesResult.success) return notesResult;
    const notes = notesResult.data;

    const cardsResult = getCardsByDeck(kitDb, deckId);
    if (!cardsResult.success) return cardsResult;
    const cards = cardsResult.data;

    const statesResult = getCardStatesByDeck(kitDb, deckId);
    if (!statesResult.success) return statesResult;
    const stateMap = new Map<string, CardState>();
    for (const s of statesResult.data) stateMap.set(s.cardId, s);

    const mediaResult = getMediaByDeck(kitDb, deckId);
    if (!mediaResult.success) return mediaResult;
    const mediaBlobs = mediaResult.data;

    // ── 2. Build stable numeric IDs ──────────────────────────────────────
    // Anki uses millisecond-timestamp–based numeric IDs. We generate
    // deterministic IDs from position to avoid collisions.
    const baseTs = Math.floor(Date.now() / 1000);
    const baseTsMs = baseTs * 1000;

    const ankiDeckId = baseTsMs + 1;

    const noteTypeIdMap = new Map<string, number>();
    noteTypes.forEach((nt, i) => noteTypeIdMap.set(nt.id, baseTsMs + 100 + i));

    const noteIdMap = new Map<string, number>();
    notes.forEach((n, i) => noteIdMap.set(n.id, baseTsMs + 1000 + i));

    const cardIdMap = new Map<string, number>();
    cards.forEach((c, i) => cardIdMap.set(c.id, baseTsMs + 100000 + i));

    // ── 3. Build the Anki SQLite database ─────────────────────────────────
    const SQL = await initSqlJs({ locateFile: getSqlJsLocator() });
    const ankiDb = new SQL.Database();

    try {
      createAnkiSchema(ankiDb);
      insertColRow(ankiDb, deck, noteTypes, ankiDeckId, noteTypeIdMap, baseTs);
      insertAnkiNotes(ankiDb, notes, noteTypes, noteTypeIdMap, noteIdMap, baseTs);
      insertAnkiCards(ankiDb, cards, notes, noteIdMap, cardIdMap, ankiDeckId, stateMap, baseTs);

      const ankiDbBytes = ankiDb.export();

      // ── 4. Build media manifest and ZIP ───────────────────────────────────
      const zip = new JSZip();
      zip.file('collection.anki2', ankiDbBytes);

      const mediaManifest: Record<string, string> = {};
      mediaBlobs.forEach((m, i) => {
        const key = String(i);
        mediaManifest[key] = m.filename;
        zip.file(key, m.data);
      });
      zip.file('media', JSON.stringify(mediaManifest));

      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
      return { success: true, data: blob };
    } finally {
      ankiDb.close();
    }
  } catch (e) {
    return { success: false, error: `Export failed: ${String(e)}` };
  }
}

// ---------------------------------------------------------------------------
// Anki schema DDL
// ---------------------------------------------------------------------------

/**
 * Create the Anki-compatible schema in the export database.
 *
 * @param db - Empty sql.js Database.
 */
function createAnkiSchema(db: Database): void {
  db.run(`
    CREATE TABLE col (
      id    INTEGER PRIMARY KEY,
      crt   INTEGER NOT NULL,
      mod   INTEGER NOT NULL,
      scm   INTEGER NOT NULL,
      ver   INTEGER NOT NULL,
      dty   INTEGER NOT NULL,
      usn   INTEGER NOT NULL,
      ls    INTEGER NOT NULL,
      conf  TEXT    NOT NULL,
      models TEXT   NOT NULL,
      decks  TEXT   NOT NULL,
      dconf  TEXT   NOT NULL,
      tags   TEXT   NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE notes (
      id    INTEGER PRIMARY KEY,
      guid  TEXT    NOT NULL,
      mid   INTEGER NOT NULL,
      mod   INTEGER NOT NULL,
      usn   INTEGER NOT NULL,
      tags  TEXT    NOT NULL,
      flds  TEXT    NOT NULL,
      sfld  TEXT    NOT NULL,
      csum  INTEGER NOT NULL,
      flags INTEGER NOT NULL,
      data  TEXT    NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE cards (
      id     INTEGER PRIMARY KEY,
      nid    INTEGER NOT NULL,
      did    INTEGER NOT NULL,
      ord    INTEGER NOT NULL,
      mod    INTEGER NOT NULL,
      usn    INTEGER NOT NULL,
      type   INTEGER NOT NULL,
      queue  INTEGER NOT NULL,
      due    INTEGER NOT NULL,
      ivl    INTEGER NOT NULL,
      factor INTEGER NOT NULL,
      reps   INTEGER NOT NULL,
      lapses INTEGER NOT NULL,
      left   INTEGER NOT NULL,
      odue   INTEGER NOT NULL,
      odid   INTEGER NOT NULL,
      flags  INTEGER NOT NULL,
      data   TEXT    NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE revlog (
      id    INTEGER PRIMARY KEY,
      cid   INTEGER NOT NULL,
      usn   INTEGER NOT NULL,
      ease  INTEGER NOT NULL,
      ivl   INTEGER NOT NULL,
      lastIvl INTEGER NOT NULL,
      factor  INTEGER NOT NULL,
      time    INTEGER NOT NULL,
      type    INTEGER NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE graves (
      usn  INTEGER NOT NULL,
      oid  INTEGER NOT NULL,
      type INTEGER NOT NULL
    )
  `);
}

// ---------------------------------------------------------------------------
// col table
// ---------------------------------------------------------------------------

/**
 * Insert the single `col` row with models and decks JSON.
 *
 * @param db            - Anki export database.
 * @param deck          - Kit deck being exported.
 * @param noteTypes     - Kit note types for this deck.
 * @param ankiDeckId    - Numeric Anki deck ID.
 * @param noteTypeIdMap - Kit UUID → Anki numeric ID for note types.
 * @param baseTs        - Base timestamp (seconds) for mod fields.
 */
function insertColRow(
  db: Database,
  deck: Deck,
  noteTypes: NoteType[],
  ankiDeckId: number,
  noteTypeIdMap: Map<string, number>,
  baseTs: number,
): void {
  // Build models JSON
  const models: Record<string, unknown> = {};
  for (const nt of noteTypes) {
    const mid = noteTypeIdMap.get(nt.id);
    if (mid === undefined) continue;
    models[String(mid)] = buildAnkiModel(nt, mid, ankiDeckId);
  }

  // If no note types exist, create a basic "Front/Back" model
  if (noteTypes.length === 0) {
    const fallbackMid = ankiDeckId + 1;
    models[String(fallbackMid)] = {
      id: fallbackMid,
      name: 'Basic',
      type: 0,
      mod: baseTs,
      usn: -1,
      sortf: 0,
      did: ankiDeckId,
      tmpls: [
        { name: 'Card 1', ord: 0, qfmt: '{{Front}}', afmt: '{{FrontSide}}<hr id=answer>{{Back}}', bqfmt: '', bafmt: '', did: null },
      ],
      flds: [
        { name: 'Front', ord: 0, sticky: false, rtl: false, font: 'Arial', size: 20, media: [] },
        { name: 'Back', ord: 1, sticky: false, rtl: false, font: 'Arial', size: 20, media: [] },
      ],
      css: '.card { font-family: arial; font-size: 20px; text-align: center; color: black; background-color: white; }',
      latexPre: '',
      latexPost: '',
      latexsvg: false,
      req: [[0, 'all', [0]]],
      tags: [],
      vers: [],
    };
  }

  // Build decks JSON — must include the default deck (id=1)
  const decks: Record<string, unknown> = {
    '1': {
      id: 1,
      mod: baseTs,
      name: 'Default',
      usn: -1,
      lrnToday: [0, 0],
      revToday: [0, 0],
      newToday: [0, 0],
      timeToday: [0, 0],
      collapsed: false,
      desc: '',
      dyn: 0,
      conf: 1,
      extendNew: 10,
      extendRev: 50,
    },
    [String(ankiDeckId)]: {
      id: ankiDeckId,
      mod: baseTs,
      name: deck.name,
      usn: -1,
      lrnToday: [0, 0],
      revToday: [0, 0],
      newToday: [0, 0],
      timeToday: [0, 0],
      collapsed: false,
      desc: deck.description,
      dyn: 0,
      conf: 1,
      extendNew: 10,
      extendRev: 50,
    },
  };

  db.run(
    `INSERT INTO col (id, crt, mod, scm, ver, dty, usn, ls, conf, models, decks, dconf, tags)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      1,
      baseTs,              // crt: collection creation time
      baseTs,              // mod: last modified
      baseTs * 1000,       // scm: schema modification time (ms)
      11,                  // ver: Anki schema version
      0,                   // dty: dirty flag
      -1,                  // usn: update sequence number
      0,                   // ls: last sync
      JSON.stringify(DEFAULT_CONF),
      JSON.stringify(models),
      JSON.stringify(decks),
      JSON.stringify(DEFAULT_DCONF),
      JSON.stringify({}),  // tags
    ],
  );
}

/**
 * Build an Anki model (note type) JSON object.
 *
 * @param nt         - Kit NoteType.
 * @param mid        - Anki numeric model ID.
 * @param ankiDeckId - Anki numeric deck ID.
 * @returns Model object suitable for col.models JSON.
 */
function buildAnkiModel(nt: NoteType, mid: number, ankiDeckId: number): Record<string, unknown> {
  return {
    id: mid,
    name: nt.name,
    type: 0, // 0 = standard, 1 = cloze
    mod: Math.floor(Date.now() / 1000),
    usn: -1,
    sortf: 0,
    did: ankiDeckId,
    tmpls: nt.templates.map((t) => ({
      name: t.name,
      ord: t.ord,
      qfmt: t.qfmt,
      afmt: t.afmt,
      bqfmt: '',
      bafmt: '',
      did: null,
    })),
    flds: nt.fields.map((name, i) => ({
      name,
      ord: i,
      sticky: false,
      rtl: false,
      font: 'Arial',
      size: 20,
      media: [],
    })),
    css: nt.css || '.card { font-family: arial; font-size: 20px; text-align: center; color: black; background-color: white; }',
    latexPre: '\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n',
    latexPost: '\\end{document}',
    latexsvg: false,
    req: nt.templates.map((t) => [t.ord, 'all', [0]]),
    tags: [],
    vers: [],
  };
}

// ---------------------------------------------------------------------------
// notes table
// ---------------------------------------------------------------------------

/**
 * Insert all notes into the Anki database.
 *
 * @param db            - Anki export database.
 * @param notes         - Kit notes to export.
 * @param noteTypes     - Kit note types (for field ordering).
 * @param noteTypeIdMap - Kit UUID → Anki numeric ID.
 * @param noteIdMap     - Kit UUID → Anki numeric ID.
 * @param baseTs        - Base timestamp for mod fields.
 */
function insertAnkiNotes(
  db: Database,
  notes: Note[],
  noteTypes: NoteType[],
  noteTypeIdMap: Map<string, number>,
  noteIdMap: Map<string, number>,
  baseTs: number,
): void {
  const ntMap = new Map<string, NoteType>();
  for (const nt of noteTypes) ntMap.set(nt.id, nt);

  const stmt = db.prepare(
    `INSERT INTO notes (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  for (const note of notes) {
    const ankiNid = noteIdMap.get(note.id);
    const ankiMid = noteTypeIdMap.get(note.noteTypeId);
    if (ankiNid === undefined || ankiMid === undefined) continue;

    const nt = ntMap.get(note.noteTypeId);

    // Build fields string: values joined by \x1f in field order
    let flds: string;
    if (nt) {
      flds = nt.fields.map((fname) => note.fields[fname] ?? '').join('\x1f');
    } else {
      flds = Object.values(note.fields).join('\x1f');
    }

    // sfld = sort field (first field value, used for sorting/searching)
    const sfld = nt
      ? (note.fields[nt.fields[0]] ?? '')
      : (Object.values(note.fields)[0] ?? '');

    // csum = checksum of first field (Anki uses fieldChecksum which is
    // sha1 of sfld truncated to first 8 hex chars → parsed as int.
    // We use a simple hash since the exact algorithm only matters for
    // duplicate detection within Anki.
    const csum = simpleChecksum(sfld);

    // guid = globally unique ID (Anki uses base91-encoded random).
    // We generate a short unique string from the note's Kit UUID.
    const guid = note.id.replace(/-/g, '').slice(0, 10);

    const tags = note.tags.length > 0 ? ` ${note.tags.join(' ')} ` : '';

    stmt.bind([ankiNid, guid, ankiMid, baseTs, -1, tags, flds, sfld, csum, 0, '']);
    stmt.step();
    stmt.reset();
  }

  stmt.free();
}

// ---------------------------------------------------------------------------
// cards table
// ---------------------------------------------------------------------------

/**
 * Insert all cards into the Anki database.
 *
 * Maps Kit's FSRS card states to Anki's scheduling fields as closely
 * as possible. Cards without a state row are exported as new (type=0).
 *
 * @param db          - Anki export database.
 * @param cards       - Kit cards to export.
 * @param notes       - Kit notes (for note → card mapping).
 * @param noteIdMap   - Kit UUID → Anki numeric note ID.
 * @param cardIdMap   - Kit UUID → Anki numeric card ID.
 * @param ankiDeckId  - Anki numeric deck ID.
 * @param stateMap    - Kit card states keyed by card ID.
 * @param baseTs      - Base timestamp for mod fields.
 */
function insertAnkiCards(
  db: Database,
  cards: Card[],
  notes: Note[],
  noteIdMap: Map<string, number>,
  cardIdMap: Map<string, number>,
  ankiDeckId: number,
  stateMap: Map<string, CardState>,
  baseTs: number,
): void {
  // Build a lookup: note Kit ID → list of cards for ordinal assignment
  const noteCardOrd = new Map<string, number>();

  const stmt = db.prepare(
    `INSERT INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  for (const card of cards) {
    const ankiCid = cardIdMap.get(card.id);
    if (ankiCid === undefined) continue;

    const ankiNid = card.noteId ? noteIdMap.get(card.noteId) : undefined;
    if (!ankiNid) continue;

    // Ordinal: increment per note
    const ord = noteCardOrd.get(card.noteId!) ?? 0;
    noteCardOrd.set(card.noteId!, ord + 1);

    const state = stateMap.get(card.id);

    let type = 0;   // new
    let queue = 0;   // new queue
    let due = 0;     // position for new cards
    let ivl = 0;     // interval in days
    let factor = 2500; // ease factor (2.5 × 1000)

    if (state) {
      const reps = state.reps;
      const lapses = state.lapses;

      switch (state.state) {
        case 'new':
          type = 0;
          queue = 0;
          due = ord;
          break;
        case 'learning':
          type = 1;
          queue = 1;
          // Due as Unix timestamp for learning cards
          due = state.due;
          break;
        case 'review':
          type = 2;
          queue = 2;
          // Due as days since Anki epoch
          due = Math.max(0, Math.floor((state.due - ANKI_EPOCH) / 86400));
          ivl = state.scheduledDays || 1;
          factor = Math.round((state.difficulty > 0 ? Math.max(1.3, 3.0 - state.difficulty * 0.17) : 2.5) * 1000);
          break;
        case 'relearning':
          type = 3;
          queue = 1;
          due = state.due;
          break;
      }

      stmt.bind([
        ankiCid, ankiNid, ankiDeckId, ord, baseTs, -1,
        type, queue, due, ivl, factor,
        reps, lapses,
        0,    // left
        0,    // odue
        0,    // odid
        0,    // flags
        '',   // data
      ]);
    } else {
      stmt.bind([
        ankiCid, ankiNid, ankiDeckId, ord, baseTs, -1,
        0, 0, ord, 0, 2500,
        0, 0,
        0, 0, 0, 0, '',
      ]);
    }

    stmt.step();
    stmt.reset();
  }

  stmt.free();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Simple numeric checksum for the sort field.
 * Anki uses SHA-1 truncated to 32 bits; we approximate with a DJB2 hash.
 *
 * @param s - String to hash.
 * @returns 32-bit unsigned integer.
 */
function simpleChecksum(s: string): number {
  let hash = 5381;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) + hash + s.charCodeAt(i)) | 0;
  }
  return hash >>> 0; // unsigned 32-bit
}
