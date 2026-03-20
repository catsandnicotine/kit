/// <reference types="vitest" />
/**
 * Tests for the .apkg parser.
 *
 * Integration tests build real in-memory .apkg fixtures using JSZip + sql.js,
 * then run them through the parser to verify end-to-end correctness.
 * Pure helper functions are tested without any I/O.
 */

import path from 'path';
import JSZip from 'jszip';
import initSqlJs from 'sql.js';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  configureSqlJsPath,
  guessMimeType,
  parseApkg,
  parseDecksJson,
  parseNoteTypesJson,
  splitFields,
} from './parser';

// In Node.js (Vitest), sql.js cannot find its WASM via the default identity
// locateFile. Point it at the actual dist directory in node_modules.
const WASM_DIR = path.join(process.cwd(), 'node_modules/sql.js/dist');
const nodeLocateFile = (file: string) => path.join(WASM_DIR, file);

beforeAll(() => {
  configureSqlJsPath(nodeLocateFile);
});

// ---------------------------------------------------------------------------
// Fixture builder
// ---------------------------------------------------------------------------

/** Minimal valid models JSON containing one Basic note type. */
const BASIC_MODELS_JSON = JSON.stringify({
  '1000000000000': {
    id:   1000000000000,
    name: 'Basic',
    type: 0,
    css:  '.card { font-family: sans-serif; }',
    flds: [
      { name: 'Front', ord: 0, sticky: false },
      { name: 'Back',  ord: 1, sticky: false },
    ],
    tmpls: [
      {
        name: 'Card 1',
        ord:  0,
        qfmt: '{{Front}}',
        afmt: '{{FrontSide}}<hr id=answer>{{Back}}',
        bqfmt: '',
        bafmt: '',
      },
    ],
  },
});

/** Minimal valid decks JSON. */
const BASIC_DECKS_JSON = JSON.stringify({
  '1': { id: 1, name: 'Default', desc: '' },
  '2000000000000': {
    id:   2000000000000,
    name: 'My Deck',
    desc: 'A test deck',
  },
});

/**
 * Build an in-memory SQLite database that mimics a real Anki collection.
 * Returns the raw bytes ready to be stored in a ZIP as collection.anki2.
 */
async function buildCollectionDb(options: {
  models?: string;
  decks?: string;
  notes?: Array<{ id: number; mid: number; tags: string; flds: string }>;
  cards?: Array<{
    id: number; nid: number; did: number; ord: number;
    type: number; due: number; ivl: number; factor: number;
    reps: number; lapses: number;
  }>;
} = {}): Promise<Uint8Array> {
  const SQL = await initSqlJs({ locateFile: nodeLocateFile });
  const db = new SQL.Database();

  // Create the col table
  db.run(`
    CREATE TABLE col (
      id INTEGER, crt INTEGER, mod INTEGER, scm INTEGER, ver INTEGER,
      dty INTEGER, usn INTEGER, ls INTEGER,
      conf TEXT, models TEXT, decks TEXT, dconf TEXT, tags TEXT
    )
  `);
  db.run(
    'INSERT INTO col VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [1, 0, 0, 0, 11, 0, -1, 0, '{}',
     options.models ?? BASIC_MODELS_JSON,
     options.decks  ?? BASIC_DECKS_JSON,
     '{}', '{}'],
  );

  // Create and populate the notes table
  db.run(`
    CREATE TABLE notes (
      id INTEGER PRIMARY KEY, guid TEXT, mid INTEGER, mod INTEGER,
      usn INTEGER, tags TEXT, flds TEXT, sfld TEXT, csum INTEGER,
      flags INTEGER, data TEXT
    )
  `);
  for (const note of options.notes ?? []) {
    db.run(
      'INSERT INTO notes (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [note.id, `guid${note.id}`, note.mid, Math.floor(note.id / 1000), -1,
       note.tags, note.flds, '', 0, 0, ''],
    );
  }

  // Create and populate the cards table
  db.run(`
    CREATE TABLE cards (
      id INTEGER PRIMARY KEY, nid INTEGER, did INTEGER, ord INTEGER,
      mod INTEGER, usn INTEGER, type INTEGER, queue INTEGER,
      due INTEGER, ivl INTEGER, factor INTEGER, reps INTEGER,
      lapses INTEGER, left INTEGER, odue INTEGER, odid INTEGER,
      flags INTEGER, data TEXT
    )
  `);
  for (const card of options.cards ?? []) {
    db.run(
      'INSERT INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [card.id, card.nid, card.did, card.ord, 0, -1,
       card.type, card.type, card.due, card.ivl, card.factor,
       card.reps, card.lapses, 0, 0, 0, 0, ''],
    );
  }

  const bytes = db.export();
  db.close();
  return bytes;
}

/**
 * Build a complete .apkg ZIP archive.
 * Returns an ArrayBuffer ready to pass to parseApkg.
 */
async function buildApkg(options: {
  dbFilename?: 'collection.anki2' | 'collection.anki21';
  dbBytes?: Uint8Array;
  mediaMapping?: Record<string, string>;
  mediaFiles?: Record<string, Uint8Array>;
  corruptDb?: boolean;
}): Promise<ArrayBuffer> {
  const zip = new JSZip();

  const filename = options.dbFilename ?? 'collection.anki2';
  if (options.corruptDb) {
    zip.file(filename, new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
  } else if (options.dbBytes) {
    zip.file(filename, options.dbBytes);
  }

  if (options.mediaMapping !== undefined) {
    zip.file('media', JSON.stringify(options.mediaMapping));
    for (const [key, data] of Object.entries(options.mediaFiles ?? {})) {
      zip.file(key, data);
    }
  } else {
    zip.file('media', '{}');
  }

  return zip.generateAsync({ type: 'arraybuffer' });
}

// ---------------------------------------------------------------------------
// splitFields
// ---------------------------------------------------------------------------

describe('splitFields', () => {
  it('splits on the \\x1f unit separator', () => {
    expect(splitFields('Hello\x1fWorld')).toEqual(['Hello', 'World']);
  });

  it('returns a single-element array when there is no separator', () => {
    expect(splitFields('OnlyFront')).toEqual(['OnlyFront']);
  });

  it('preserves empty fields', () => {
    expect(splitFields('A\x1f\x1fC')).toEqual(['A', '', 'C']);
  });

  it('handles HTML content inside fields', () => {
    const flds = '<b>Bold</b>\x1f<i>Italic</i>';
    expect(splitFields(flds)).toEqual(['<b>Bold</b>', '<i>Italic</i>']);
  });

  it('handles an empty string', () => {
    expect(splitFields('')).toEqual(['']);
  });
});

// ---------------------------------------------------------------------------
// parseNoteTypesJson
// ---------------------------------------------------------------------------

describe('parseNoteTypesJson', () => {
  it('parses a basic model correctly', () => {
    const types = parseNoteTypesJson(BASIC_MODELS_JSON);
    expect(types).toHaveLength(1);

    const t = types[0]!;
    expect(t.id).toBe('1000000000000');
    expect(t.name).toBe('Basic');
    expect(t.fields).toEqual(['Front', 'Back']);
    expect(t.css).toContain('font-family');
  });

  it('sorts fields by ordinal', () => {
    const json = JSON.stringify({
      '1': {
        id: 1, name: 'Reversed', css: '',
        flds: [
          { name: 'Second', ord: 1 },
          { name: 'First',  ord: 0 },
        ],
        tmpls: [],
      },
    });
    const t = parseNoteTypesJson(json)[0]!;
    expect(t.fields).toEqual(['First', 'Second']);
  });

  it('sorts templates by ordinal', () => {
    const json = JSON.stringify({
      '1': {
        id: 1, name: 'Multi', css: '',
        flds: [{ name: 'F', ord: 0 }],
        tmpls: [
          { name: 'Card 2', ord: 1, qfmt: 'q2', afmt: 'a2' },
          { name: 'Card 1', ord: 0, qfmt: 'q1', afmt: 'a1' },
        ],
      },
    });
    const t = parseNoteTypesJson(json)[0]!;
    expect(t.templates[0]!.name).toBe('Card 1');
    expect(t.templates[1]!.name).toBe('Card 2');
  });

  it('exposes qfmt and afmt on templates', () => {
    const t = parseNoteTypesJson(BASIC_MODELS_JSON)[0]!;
    expect(t.templates[0]!.qfmt).toBe('{{Front}}');
    expect(t.templates[0]!.afmt).toContain('{{Back}}');
  });

  it('throws on invalid JSON', () => {
    expect(() => parseNoteTypesJson('{not valid json')).toThrow();
  });

  it('throws when the value is not an object', () => {
    expect(() => parseNoteTypesJson('"just a string"')).toThrow();
  });

  it('handles multiple note types', () => {
    const json = JSON.stringify({
      '1': { id: 1, name: 'A', css: '', flds: [], tmpls: [] },
      '2': { id: 2, name: 'B', css: '', flds: [], tmpls: [] },
    });
    expect(parseNoteTypesJson(json)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// parseDecksJson
// ---------------------------------------------------------------------------

describe('parseDecksJson', () => {
  it('parses a deck correctly', () => {
    const decks = parseDecksJson(BASIC_DECKS_JSON);
    const myDeck = decks.find((d) => d.name === 'My Deck');
    expect(myDeck).toBeDefined();
    expect(myDeck?.id).toBe('2000000000000');
    expect(myDeck?.description).toBe('A test deck');
  });

  it('returns all decks', () => {
    expect(parseDecksJson(BASIC_DECKS_JSON)).toHaveLength(2);
  });

  it('returns empty description when desc is absent', () => {
    const json = JSON.stringify({ '1': { id: 1, name: 'X' } });
    const d = parseDecksJson(json)[0]!;
    expect(d.description).toBe('');
  });

  it('throws on invalid JSON', () => {
    expect(() => parseDecksJson('{')).toThrow();
  });

  it('throws when the value is not an object', () => {
    expect(() => parseDecksJson('[1,2,3]')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// guessMimeType
// ---------------------------------------------------------------------------

describe('guessMimeType', () => {
  it.each([
    ['photo.jpg',  'image/jpeg'],
    ['photo.jpeg', 'image/jpeg'],
    ['icon.png',   'image/png'],
    ['anim.gif',   'image/gif'],
    ['logo.svg',   'image/svg+xml'],
    ['pic.webp',   'image/webp'],
    ['sound.mp3',  'audio/mpeg'],
    ['audio.ogg',  'audio/ogg'],
    ['clip.mp4',   'video/mp4'],
    ['doc.pdf',    'application/pdf'],
  ])('%s → %s', (filename, expected) => {
    expect(guessMimeType(filename)).toBe(expected);
  });

  it('returns application/octet-stream for unknown extensions', () => {
    expect(guessMimeType('file.xyz')).toBe('application/octet-stream');
  });

  it('is case-insensitive on extension', () => {
    expect(guessMimeType('IMAGE.PNG')).toBe('image/png');
  });

  it('handles filenames with no extension', () => {
    expect(guessMimeType('README')).toBe('application/octet-stream');
  });
});

// ---------------------------------------------------------------------------
// parseApkg — error handling
// ---------------------------------------------------------------------------

describe('parseApkg — error handling', () => {
  it('returns an error for a completely corrupt buffer', async () => {
    const corrupt = new ArrayBuffer(16);
    new Uint8Array(corrupt).fill(0xff);
    const result = await parseApkg(corrupt);
    expect(result.success).toBe(false);
    expect(result).toMatchObject({ success: false });
    if (!result.success) {
      expect(result.error.length).toBeGreaterThan(0);
    }
  });

  it('returns an error for a ZIP that has no collection database', async () => {
    const zip = new JSZip();
    zip.file('readme.txt', 'not a database');
    const buf = await zip.generateAsync({ type: 'arraybuffer' });
    const result = await parseApkg(buf);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/collection/i);
    }
  });

  it('returns an error for a ZIP with a corrupt SQLite file', async () => {
    const buf = await buildApkg({ corruptDb: true });
    const result = await parseApkg(buf);
    expect(result.success).toBe(false);
  });

  it('returns an error for an empty ArrayBuffer', async () => {
    const result = await parseApkg(new ArrayBuffer(0));
    expect(result.success).toBe(false);
  });

  it('returns an error for a ZIP with malformed models JSON', async () => {
    const db = await buildCollectionDb({ models: '{invalid json' });
    const buf = await buildApkg({ dbBytes: db });
    const result = await parseApkg(buf);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/note type/i);
  });

  it('returns an error for a ZIP with malformed decks JSON', async () => {
    const db = await buildCollectionDb({ decks: 'not-json' });
    const buf = await buildApkg({ dbBytes: db });
    const result = await parseApkg(buf);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/deck/i);
  });
});

// ---------------------------------------------------------------------------
// parseApkg — ZIP structure
// ---------------------------------------------------------------------------

describe('parseApkg — ZIP structure', () => {
  it('prefers collection.anki21 over collection.anki2', async () => {
    // Both files present — anki21 wins
    const dbAnki2  = await buildCollectionDb({ decks: JSON.stringify({ '1': { id: 1, name: 'Old', desc: '' } }) });
    const dbAnki21 = await buildCollectionDb({ decks: JSON.stringify({ '1': { id: 1, name: 'New', desc: '' } }) });

    const zip = new JSZip();
    zip.file('collection.anki2',  dbAnki2);
    zip.file('collection.anki21', dbAnki21);
    zip.file('media', '{}');
    const buf = await zip.generateAsync({ type: 'arraybuffer' });

    const result = await parseApkg(buf);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.decks.find((d) => d.name === 'New')).toBeDefined();
    }
  });

  it('falls back to collection.anki2 when anki21 is absent', async () => {
    const db  = await buildCollectionDb();
    const buf = await buildApkg({ dbFilename: 'collection.anki2', dbBytes: db });
    const result = await parseApkg(buf);
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// parseApkg — decks and note types
// ---------------------------------------------------------------------------

describe('parseApkg — decks and note types', () => {
  it('returns all decks from the collection', async () => {
    const db  = await buildCollectionDb();
    const buf = await buildApkg({ dbBytes: db });
    const result = await parseApkg(buf);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.decks.length).toBeGreaterThanOrEqual(1);
    expect(result.data.decks.some((d) => d.name === 'My Deck')).toBe(true);
  });

  it('returns note types with fields and templates', async () => {
    const db  = await buildCollectionDb();
    const buf = await buildApkg({ dbBytes: db });
    const result = await parseApkg(buf);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const basic = result.data.noteTypes.find((t) => t.name === 'Basic');
    expect(basic).toBeDefined();
    expect(basic?.fields).toEqual(['Front', 'Back']);
    expect(basic?.templates[0]?.qfmt).toBe('{{Front}}');
    expect(basic?.css).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// parseApkg — note field splitting
// ---------------------------------------------------------------------------

describe('parseApkg — note field splitting', () => {
  it('splits note fields on \\x1f and returns them as an array', async () => {
    const noteId = 1700000000000;
    const db = await buildCollectionDb({
      notes: [{ id: noteId, mid: 1000000000000, tags: '', flds: 'Hello\x1fWorld' }],
    });
    const buf = await buildApkg({ dbBytes: db });
    const result = await parseApkg(buf);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const note = result.data.notes[0]!;
    expect(note.fields).toEqual(['Hello', 'World']);
  });

  it('sets noteTypeId from the mid column', async () => {
    const db = await buildCollectionDb({
      notes: [{ id: 1700000000001, mid: 1000000000000, tags: '', flds: 'A\x1fB' }],
    });
    const buf = await buildApkg({ dbBytes: db });
    const result = await parseApkg(buf);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.notes[0]!.noteTypeId).toBe('1000000000000');
  });

  it('splits tags on whitespace', async () => {
    const db = await buildCollectionDb({
      notes: [{
        id: 1700000000002, mid: 1000000000000,
        tags: ' alpha beta gamma ', flds: 'Q\x1fA',
      }],
    });
    const buf = await buildApkg({ dbBytes: db });
    const result = await parseApkg(buf);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.notes[0]!.tags).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('sets tags to [] when the tags column is blank', async () => {
    const db = await buildCollectionDb({
      notes: [{ id: 1700000000003, mid: 1000000000000, tags: '  ', flds: 'Q\x1fA' }],
    });
    const buf = await buildApkg({ dbBytes: db });
    const result = await parseApkg(buf);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.notes[0]!.tags).toEqual([]);
  });

  it('derives createdAt from the note ID (ms → seconds)', async () => {
    const noteId = 1700000000000; // ms
    const db = await buildCollectionDb({
      notes: [{ id: noteId, mid: 1000000000000, tags: '', flds: 'Q\x1fA' }],
    });
    const buf = await buildApkg({ dbBytes: db });
    const result = await parseApkg(buf);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.notes[0]!.createdAt).toBe(Math.floor(noteId / 1000));
  });

  it('returns an empty notes array when the table has no rows', async () => {
    const db  = await buildCollectionDb({ notes: [] });
    const buf = await buildApkg({ dbBytes: db });
    const result = await parseApkg(buf);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.notes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// parseApkg — card scheduling data
// ---------------------------------------------------------------------------

describe('parseApkg — card scheduling data', () => {
  it('extracts card fields correctly', async () => {
    const db = await buildCollectionDb({
      notes: [{ id: 1700000000010, mid: 1000000000000, tags: '', flds: 'Q\x1fA' }],
      cards: [{
        id: 1700000000011, nid: 1700000000010, did: 2000000000000,
        ord: 0, type: 2, due: 1000, ivl: 21, factor: 2500,
        reps: 5, lapses: 1,
      }],
    });
    const buf = await buildApkg({ dbBytes: db });
    const result = await parseApkg(buf);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const card = result.data.cards[0]!;
    expect(card.noteId).toBe('1700000000010');
    expect(card.deckId).toBe('2000000000000');
    expect(card.templateOrd).toBe(0);
    expect(card.type).toBe(2);
    expect(card.interval).toBe(21);
    expect(card.factor).toBe(2500);
    expect(card.reps).toBe(5);
    expect(card.lapses).toBe(1);
  });

  it('returns an empty cards array when the table has no rows', async () => {
    const db  = await buildCollectionDb({ cards: [] });
    const buf = await buildApkg({ dbBytes: db });
    const result = await parseApkg(buf);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.cards).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// parseApkg — media mapping
// ---------------------------------------------------------------------------

describe('parseApkg — media mapping', () => {
  it('extracts media blobs with correct filename and MIME type', async () => {
    const imageData = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG magic bytes
    const db  = await buildCollectionDb();
    const buf = await buildApkg({
      dbBytes: db,
      mediaMapping: { '0': 'cat.png' },
      mediaFiles:   { '0': imageData },
    });

    const result = await parseApkg(buf);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.media).toHaveLength(1);
    const m = result.data.media[0]!;
    expect(m.filename).toBe('cat.png');
    expect(m.mimeType).toBe('image/png');
    expect(m.data).toEqual(imageData);
  });

  it('handles multiple media files', async () => {
    const db  = await buildCollectionDb();
    const buf = await buildApkg({
      dbBytes: db,
      mediaMapping: { '0': 'img.jpg', '1': 'sound.mp3' },
      mediaFiles: {
        '0': new Uint8Array([0xff, 0xd8]),
        '1': new Uint8Array([0x49, 0x44, 0x33]),
      },
    });

    const result = await parseApkg(buf);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.media).toHaveLength(2);
  });

  it('returns empty media array when media file is absent', async () => {
    // buildApkg always adds an empty media file, so test without it manually
    const db = await buildCollectionDb();
    const zip = new JSZip();
    zip.file('collection.anki2', db);
    // intentionally do NOT add a media file
    const buf = await zip.generateAsync({ type: 'arraybuffer' });

    const result = await parseApkg(buf);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.media).toEqual([]);
  });

  it('skips media entries whose blob is missing from the ZIP', async () => {
    const db = await buildCollectionDb();
    const buf = await buildApkg({
      dbBytes: db,
      mediaMapping: { '0': 'missing.png' },
      mediaFiles:   {},  // blob not added
    });

    const result = await parseApkg(buf);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.media).toEqual([]);
  });

  it('returns empty media array when the media JSON is corrupt', async () => {
    const db = await buildCollectionDb();
    const zip = new JSZip();
    zip.file('collection.anki2', db);
    zip.file('media', 'not valid json {{{');
    const buf = await zip.generateAsync({ type: 'arraybuffer' });

    const result = await parseApkg(buf);
    // Corrupt media manifest should NOT fail the whole parse
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.media).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// parseApkg — File input
// ---------------------------------------------------------------------------

describe('parseApkg — File input', () => {
  it('accepts a File object in addition to ArrayBuffer', async () => {
    const db  = await buildCollectionDb();
    const buf = await buildApkg({ dbBytes: db });

    const file = new File([buf], 'test.apkg', { type: 'application/zip' });
    const result = await parseApkg(file);
    expect(result.success).toBe(true);
  });
});
