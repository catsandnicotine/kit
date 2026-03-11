/**
 * Anki .apkg file parser.
 *
 * .apkg files are ZIP archives containing:
 *   collection.anki2  / collection.anki21 — SQLite database
 *   media                                 — JSON mapping: "0" → "filename.jpg"
 *   0, 1, 2 …                             — binary media blobs
 *
 * This module has ZERO imports from React, UI, or platform code.
 */

import JSZip from 'jszip';
import initSqlJs from 'sql.js';
import type { Database } from 'sql.js';
import type { Result } from '../../types';

// ---------------------------------------------------------------------------
// Public output types
// ---------------------------------------------------------------------------

/** A card template extracted from a note type. */
export interface ParsedTemplate {
  name: string;
  /** Ordinal position — determines which card is generated. */
  ord: number;
  /** Question-side template (may contain {{FieldName}} mustache tokens). */
  qfmt: string;
  /** Answer-side template. */
  afmt: string;
}

/** An Anki note type (model), describing field names and card templates. */
export interface ParsedNoteType {
  /** Anki model ID (numeric string). */
  id: string;
  name: string;
  /** Ordered field names, e.g. ['Front', 'Back', 'Extra']. */
  fields: string[];
  templates: ParsedTemplate[];
  /** CSS stylesheet shared by all templates in this note type. */
  css: string;
}

/** An Anki deck extracted from the collection. */
export interface ParsedAnkiDeck {
  /** Anki deck ID (numeric string). */
  id: string;
  name: string;
  description: string;
}

/**
 * A parsed Anki note.
 * fields is the ordered array of raw field values (split on \x1f).
 */
export interface ParsedNote {
  /** Anki note ID (ms timestamp as string). */
  id: string;
  /** Anki model ID this note belongs to. */
  noteTypeId: string;
  /** Raw field values in the same order as ParsedNoteType.fields. */
  fields: string[];
  /** Tags for this note. */
  tags: string[];
  /** Unix timestamp (seconds) when the note was created. */
  createdAt: number;
}

/** An Anki card with raw scheduling data from the source collection. */
export interface ParsedCard {
  /** Anki card ID (ms timestamp as string). */
  id: string;
  /** Anki note ID this card was generated from. */
  noteId: string;
  /** Anki deck ID this card belongs to. */
  deckId: string;
  /** Template ordinal — index into the note type's templates array. */
  templateOrd: number;
  /**
   * Anki card type:
   *  0 = new, 1 = learning, 2 = review, 3 = relearning
   */
  type: number;
  /**
   * Anki due value. Interpretation depends on type:
   *  - new: card position
   *  - learning: Unix timestamp (seconds)
   *  - review: days since Anki epoch (2006-01-01)
   */
  due: number;
  /** Interval in days (negative = seconds, for intra-day learning steps). */
  interval: number;
  /** Ease factor (raw Anki value, divide by 1000 for multiplier). */
  factor: number;
  reps: number;
  lapses: number;
}

/** A media file extracted from the .apkg archive. */
export interface ParsedMedia {
  /** Original filename as stored in the Anki deck. */
  filename: string;
  data: Uint8Array;
  mimeType: string;
}

/** The complete structured output of a successful .apkg parse. */
export interface ParsedApkg {
  decks: ParsedAnkiDeck[];
  noteTypes: ParsedNoteType[];
  notes: ParsedNote[];
  cards: ParsedCard[];
  media: ParsedMedia[];
}

// ---------------------------------------------------------------------------
// sql.js path configuration
// ---------------------------------------------------------------------------

/**
 * Resolver used to locate the sql-wasm.wasm file.
 * Defaults to identity — works in Node.js (Vitest) where sql.js finds the WASM
 * relative to its own dist directory.
 * Override at app startup for browser/Capacitor deployments.
 */
let wasmLocator: (filename: string) => string = (f) => f;

/**
 * Configure how sql.js resolves its WASM binary.
 * Call once at application startup before any .apkg parsing.
 *
 * @example — Vite / Capacitor (WASM served from public root):
 *   configureSqlJsPath(file => `/${file}`);
 *
 * @param locateFile - Maps a bare filename (e.g. "sql-wasm.wasm") to a URL or path.
 */
export function configureSqlJsPath(locateFile: (filename: string) => string): void {
  wasmLocator = locateFile;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Parse an Anki .apkg file.
 *
 * Accepts a browser `File` object or a raw `ArrayBuffer` so it can be called
 * from both the Capacitor file-picker flow and unit tests.
 *
 * @param input - The raw .apkg bytes.
 * @returns Fully-parsed deck data, or a descriptive error.
 */
export async function parseApkg(
  input: File | ArrayBuffer,
): Promise<Result<ParsedApkg>> {
  try {
    // 1. Normalise input to ArrayBuffer
    const buffer: ArrayBuffer =
      input instanceof File ? await input.arrayBuffer() : input;

    // 2. Unzip
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(buffer);
    } catch (e) {
      return { success: false, error: `Could not unzip file: ${String(e)}` };
    }

    // 3. Locate the collection database (anki21 takes precedence)
    const dbEntry =
      zip.file('collection.anki21') ??
      zip.file('collection.anki2');
    if (!dbEntry) {
      return {
        success: false,
        error: 'No collection database found — expected collection.anki2 or collection.anki21',
      };
    }

    const dbBytes = await dbEntry.async('uint8array');

    // 4. Load into sql.js
    let SQL: Awaited<ReturnType<typeof initSqlJs>>;
    try {
      SQL = await initSqlJs({ locateFile: wasmLocator });
    } catch (e) {
      return { success: false, error: `Failed to load sql.js WASM: ${String(e)}` };
    }

    const db = new SQL.Database(dbBytes);
    try {
      // 5. Read the col table
      const colRows = db.exec('SELECT models, decks FROM col LIMIT 1');
      if (!colRows.length || !colRows[0].values.length) {
        return { success: false, error: 'Collection table is empty or corrupt' };
      }

      const [modelsJson, decksJson] = colRows[0].values[0] as [string, string];

      let noteTypes: ParsedNoteType[];
      try {
        noteTypes = parseNoteTypesJson(modelsJson);
      } catch (e) {
        return { success: false, error: `Could not parse note types: ${String(e)}` };
      }

      let decks: ParsedAnkiDeck[];
      try {
        decks = parseDecksJson(decksJson);
      } catch (e) {
        return { success: false, error: `Could not parse decks: ${String(e)}` };
      }

      // 6. Extract notes
      const notes = extractNotes(db);

      // 7. Extract cards
      const cards = extractCards(db);

      // 8. Parse media
      const media = await extractMedia(zip);

      return { success: true, data: { decks, noteTypes, notes, cards, media } };
    } finally {
      db.close();
    }
  } catch (e) {
    return { success: false, error: `Unexpected error parsing .apkg: ${String(e)}` };
  }
}

// ---------------------------------------------------------------------------
// Exported helpers (also used in tests)
// ---------------------------------------------------------------------------

/**
 * Split an Anki note's raw `flds` string into individual field values.
 * Anki uses the ASCII unit separator (U+001F, \x1f) as the delimiter.
 *
 * @param flds - Raw flds string from the notes table.
 * @returns Ordered array of field values (may contain HTML).
 */
export function splitFields(flds: string): string[] {
  return flds.split('\x1f');
}

/**
 * Parse the `models` JSON blob from the col table into structured note types.
 *
 * @param json - Raw JSON string from col.models.
 * @returns Array of ParsedNoteType, sorted by name for deterministic ordering.
 * @throws If json is malformed or missing required keys.
 */
export function parseNoteTypesJson(json: string): ParsedNoteType[] {
  const raw: unknown = JSON.parse(json); // throws on invalid JSON
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('models JSON is not an object');
  }

  return Object.values(raw as Record<string, unknown>).map((entry) => {
    const m = entry as Record<string, unknown>;

    if (typeof m['id'] === 'undefined') {
      throw new Error('Note type is missing required "id" field');
    }

    // Fields: sort by ordinal
    const rawFlds = (m['flds'] ?? []) as Array<Record<string, unknown>>;
    const fields = [...rawFlds]
      .sort((a, b) => Number(a['ord'] ?? 0) - Number(b['ord'] ?? 0))
      .map((f) => String(f['name'] ?? ''));

    // Templates: sort by ordinal
    const rawTmpls = (m['tmpls'] ?? []) as Array<Record<string, unknown>>;
    const templates: ParsedTemplate[] = [...rawTmpls]
      .sort((a, b) => Number(a['ord'] ?? 0) - Number(b['ord'] ?? 0))
      .map((t) => ({
        name: String(t['name'] ?? ''),
        ord:  Number(t['ord'] ?? 0),
        qfmt: String(t['qfmt'] ?? ''),
        afmt: String(t['afmt'] ?? ''),
      }));

    return {
      id:        String(m['id']),
      name:      String(m['name'] ?? ''),
      fields,
      templates,
      css:       String(m['css'] ?? ''),
    };
  });
}

/**
 * Parse the `decks` JSON blob from the col table.
 *
 * @param json - Raw JSON string from col.decks.
 * @returns Array of ParsedAnkiDeck.
 * @throws If json is malformed.
 */
export function parseDecksJson(json: string): ParsedAnkiDeck[] {
  const raw: unknown = JSON.parse(json); // throws on invalid JSON
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('decks JSON is not an object');
  }

  return Object.values(raw as Record<string, unknown>).map((entry) => {
    const d = entry as Record<string, unknown>;
    return {
      id:          String(d['id'] ?? ''),
      name:        String(d['name'] ?? ''),
      description: String(d['desc'] ?? ''),
    };
  });
}

/**
 * Guess a MIME type from a file extension.
 *
 * @param filename - Filename including extension.
 * @returns MIME type string, or 'application/octet-stream' for unknown types.
 */
export function guessMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const MAP: Record<string, string> = {
    jpg:  'image/jpeg',
    jpeg: 'image/jpeg',
    png:  'image/png',
    gif:  'image/gif',
    svg:  'image/svg+xml',
    webp: 'image/webp',
    avif: 'image/avif',
    mp3:  'audio/mpeg',
    ogg:  'audio/ogg',
    wav:  'audio/wav',
    flac: 'audio/flac',
    mp4:  'video/mp4',
    webm: 'video/webm',
    pdf:  'application/pdf',
  };
  return MAP[ext] ?? 'application/octet-stream';
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Anki SqlValue row type (columns are string-keyed). */
type Row = (number | string | null | Uint8Array | bigint)[];

/**
 * Extract all notes from the open collection database.
 * Fields are split on the \x1f separator.
 *
 * @param db - Open sql.js Database (caller is responsible for closing).
 * @returns All notes in the collection.
 */
function extractNotes(db: Database): ParsedNote[] {
  const results = db.exec('SELECT id, mid, tags, flds FROM notes');
  if (!results.length) return [];

  const { columns, values } = results[0];
  const iId   = columns.indexOf('id');
  const iMid  = columns.indexOf('mid');
  const iTags = columns.indexOf('tags');
  const iFlds = columns.indexOf('flds');

  return (values as Row[]).map((row) => {
    const rawTags = String(row[iTags] ?? '').trim();
    const tags = rawTags.length ? rawTags.split(/\s+/) : [];

    // Anki note IDs are millisecond timestamps; createdAt is seconds
    const idMs = Number(row[iId]);

    return {
      id:         String(row[iId]),
      noteTypeId: String(row[iMid]),
      fields:     splitFields(String(row[iFlds] ?? '')),
      tags,
      createdAt:  Math.floor(idMs / 1000),
    };
  });
}

/**
 * Extract all cards from the open collection database.
 *
 * @param db - Open sql.js Database.
 * @returns All cards with their raw Anki scheduling values.
 */
function extractCards(db: Database): ParsedCard[] {
  const results = db.exec(
    'SELECT id, nid, did, ord, type, due, ivl, factor, reps, lapses FROM cards',
  );
  if (!results.length) return [];

  const { columns, values } = results[0];
  const iId     = columns.indexOf('id');
  const iNid    = columns.indexOf('nid');
  const iDid    = columns.indexOf('did');
  const iOrd    = columns.indexOf('ord');
  const iType   = columns.indexOf('type');
  const iDue    = columns.indexOf('due');
  const iIvl    = columns.indexOf('ivl');
  const iFactor = columns.indexOf('factor');
  const iReps   = columns.indexOf('reps');
  const iLapses = columns.indexOf('lapses');

  return (values as Row[]).map((row) => ({
    id:          String(row[iId]),
    noteId:      String(row[iNid]),
    deckId:      String(row[iDid]),
    templateOrd: Number(row[iOrd]),
    type:        Number(row[iType]),
    due:         Number(row[iDue]),
    interval:    Number(row[iIvl]),
    factor:      Number(row[iFactor]),
    reps:        Number(row[iReps]),
    lapses:      Number(row[iLapses]),
  }));
}

/**
 * Parse the media manifest and extract all media blobs from the ZIP.
 *
 * The `media` file in an .apkg is a JSON object mapping numeric string keys
 * (the filename inside the ZIP) to the original filename:
 *   { "0": "cat.jpg", "1": "meow.mp3" }
 *
 * @param zip - Loaded JSZip instance.
 * @returns All successfully extracted media files.
 */
async function extractMedia(zip: JSZip): Promise<ParsedMedia[]> {
  const mediaEntry = zip.file('media');
  if (!mediaEntry) return [];

  let mapping: Record<string, string>;
  try {
    const raw = await mediaEntry.async('text');
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return [];
    }
    mapping = parsed as Record<string, string>;
  } catch {
    // Corrupt media manifest — skip all media rather than failing the whole parse
    return [];
  }

  const results: ParsedMedia[] = [];
  for (const [zipKey, filename] of Object.entries(mapping)) {
    const entry = zip.file(zipKey);
    if (!entry) continue; // referenced but missing blob — skip gracefully

    try {
      const data = await entry.async('uint8array');
      results.push({
        filename,
        data,
        mimeType: guessMimeType(filename),
      });
    } catch {
      // Individual media blob unreadable — skip, don't fail the whole parse
    }
  }

  return results;
}
