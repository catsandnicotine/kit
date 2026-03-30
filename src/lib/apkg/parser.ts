/**
 * Anki .apkg file parser.
 *
 * .apkg files are ZIP archives containing:
 *   collection.anki21b / collection.anki21 / collection.anki2 — SQLite database
 *   media                                 — JSON mapping: "0" → "filename.jpg"
 *   0, 1, 2 …                             — binary media blobs
 *
 * Newer exports (Anki 2.1.50+) include a `meta` protobuf file. When
 * meta.version >= 1 the database is zstd-compressed; when >= 2 media
 * blobs are individually zstd-compressed too.
 *
 * This module has ZERO imports from React, UI, or platform code.
 */

import JSZip from 'jszip';
import { decompress as zstdDecompress } from 'fzstd';
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

/** Lightweight media manifest entry — metadata only, no binary data. */
export interface MediaManifestEntry {
  /** Numeric key inside the ZIP archive (e.g. "0", "1"). */
  zipKey: string;
  /** Original filename (e.g. "cat.jpg"). */
  filename: string;
  /** Guessed MIME type. */
  mimeType: string;
}

/**
 * Lazy parse result: structural data + a media manifest without blob data.
 * The caller extracts media blobs in batches via {@link extractMediaBatch}
 * to avoid holding 1-2 GB of media in memory at once.
 */
export interface ParsedApkgLazy {
  decks: ParsedAnkiDeck[];
  noteTypes: ParsedNoteType[];
  notes: ParsedNote[];
  cards: ParsedCard[];
  /** Metadata-only media manifest (no Uint8Array data). */
  mediaManifest: MediaManifestEntry[];
  /** The open JSZip instance — needed by {@link extractMediaBatch}. */
  zip: JSZip;
  /** True when media blobs are individually zstd-compressed (meta version >= 2). */
  mediaIsCompressed: boolean;
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
 * Pre-loaded WASM binary. When set, passed directly to initSqlJs so it never
 * needs to fetch the file itself — bypassing Capacitor iOS MIME-type issues.
 */
let wasmBinaryCache: ArrayBuffer | undefined;

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

/**
 * Store a pre-fetched WASM binary so that initSqlJs calls in the parser and
 * exporter can skip fetching entirely. Call once at app startup alongside
 * configureSqlJsPath.
 *
 * @param binary - The raw sql-wasm.wasm bytes.
 */
export function configureWasmBinary(binary: ArrayBuffer): void {
  wasmBinaryCache = binary;
}

/**
 * Get the currently configured WASM locator function.
 * Used by the exporter to reuse the same configuration.
 *
 * @returns The current locateFile function.
 */
export function getSqlJsLocator(): (filename: string) => string {
  return wasmLocator;
}

/**
 * Get the pre-loaded WASM binary, if one has been configured.
 * Used by the exporter to reuse the same binary.
 *
 * @returns The cached WASM binary, or undefined if not pre-loaded.
 */
export function getWasmBinary(): ArrayBuffer | undefined {
  return wasmBinaryCache;
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

    // 3. Load sql.js
    let SQL: Awaited<ReturnType<typeof initSqlJs>>;
    try {
      SQL = await initSqlJs({ locateFile: wasmLocator, ...(wasmBinaryCache && { wasmBinary: wasmBinaryCache }) });
    } catch (e) {
      return { success: false, error: `Failed to load sql.js WASM: ${String(e)}` };
    }

    // 4. Try each collection database in priority order.
    // collection.anki21b may be pure protobuf (not SQLite) in some Anki
    // versions, so we gracefully fall back if sql.js can't open it.
    const candidates = [
      'collection.anki21b',
      'collection.anki21',
      'collection.anki2',
    ];

    const { db, dbName } = await openFirstDatabase(zip, SQL, candidates);
    if (!db) {
      if (dbName === 'stub') {
        return {
          success: false,
          error: 'This deck was exported with a newer Anki format that Kit can\'t read yet. Please re-export from Anki with the "Support older Anki versions" option checked, or use "Anki Deck Package (.apkg)" with compatibility mode.',
        };
      }
      return {
        success: false,
        error: 'No readable collection database found in this .apkg file.',
      };
    }

    try {
      const struct = extractStructure(db, dbName);
      if (!struct.success) return struct;
      const { noteTypes, decks } = struct.data;

      // 5. Extract notes and cards (same schema in both formats)
      const notes = extractNotes(db);
      const cards = extractCards(db);

      // 6. Parse media
      const media = await extractMedia(zip);

      return { success: true, data: { decks, noteTypes, notes, cards, media } };
    } finally {
      db.close();
    }
  } catch (e) {
    return { success: false, error: `Unexpected error parsing .apkg: ${String(e)}` };
  }
}

/**
 * Parse an .apkg file without loading media blobs into memory.
 *
 * Returns all structural data (decks, note types, notes, cards) plus a
 * lightweight media manifest. The caller should then use
 * {@link extractMediaBatch} to stream blobs into the database in chunks,
 * avoiding the 1-2 GB memory spike that happens when a large deck's media
 * is materialised all at once.
 *
 * @param input - The raw .apkg bytes.
 * @returns Lazy parse result with media manifest, or a descriptive error.
 */
export async function parseApkgLazy(
  input: File | ArrayBuffer,
): Promise<Result<ParsedApkgLazy>> {
  try {
    const buffer: ArrayBuffer =
      input instanceof File ? await input.arrayBuffer() : input;

    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(buffer);
    } catch (e) {
      return { success: false, error: `Could not unzip file: ${String(e)}` };
    }

    // Load sql.js
    let SQL: Awaited<ReturnType<typeof initSqlJs>>;
    try {
      SQL = await initSqlJs({ locateFile: wasmLocator, ...(wasmBinaryCache && { wasmBinary: wasmBinaryCache }) });
    } catch (e) {
      return { success: false, error: `Failed to load sql.js WASM: ${String(e)}` };
    }

    // Try each collection database in priority order.
    // collection.anki21b may be pure protobuf (not SQLite) in some versions.
    const candidates = [
      'collection.anki21b',
      'collection.anki21',
      'collection.anki2',
    ];

    const { db, dbName } = await openFirstDatabase(zip, SQL, candidates);
    if (!db) {
      if (dbName === 'stub') {
        return {
          success: false,
          error: 'This deck was exported with a newer Anki format that Kit can\'t read yet. Please re-export from Anki with the "Support older Anki versions" option checked, or use "Anki Deck Package (.apkg)" with compatibility mode.',
        };
      }
      return {
        success: false,
        error: 'No readable collection database found in this .apkg file.',
      };
    }

    try {
      const struct = extractStructure(db, dbName);
      if (!struct.success) return struct;
      const { noteTypes, decks } = struct.data;

      const notes = extractNotes(db);
      const cards = extractCards(db);

      // Build media manifest without extracting blob data
      const mediaManifest = await buildMediaManifest(zip);

      // Check if media blobs are zstd-compressed (meta version >= 2)
      const metaVersion = await readMetaVersion(zip);
      const mediaIsCompressed = metaVersion >= 2;

      return {
        success: true,
        data: { decks, noteTypes, notes, cards, mediaManifest, zip, mediaIsCompressed },
      };
    } finally {
      db.close();
    }
  } catch (e) {
    return { success: false, error: `Unexpected error parsing .apkg: ${String(e)}` };
  }
}

/**
 * Extract a batch of media blobs from a previously-parsed .apkg ZIP.
 *
 * Call this in a loop with increasing `startIdx` to stream media into the
 * database without holding the entire media set in memory.
 *
 * @param zip              - The JSZip instance from {@link ParsedApkgLazy}.
 * @param manifest         - The full media manifest from {@link ParsedApkgLazy}.
 * @param startIdx         - Index into `manifest` to start extracting from.
 * @param batchSize        - Maximum number of blobs to extract in this batch.
 * @param mediaCompressed  - True if media blobs are zstd-compressed (meta v2+).
 * @returns Array of extracted media (may be shorter than batchSize if
 *          entries are missing or unreadable).
 */
export async function extractMediaBatch(
  zip: JSZip,
  manifest: MediaManifestEntry[],
  startIdx: number,
  batchSize: number,
  _mediaCompressed = false,
): Promise<ParsedMedia[]> {
  const end = Math.min(startIdx + batchSize, manifest.length);
  const results: ParsedMedia[] = [];

  for (let i = startIdx; i < end; i++) {
    const entry = manifest[i];
    if (!entry) continue;
    const file = zip.file(entry.zipKey);
    if (!file) continue;

    try {
      let data = await file.async('uint8array');
      // Always try zstd decompression — some exports compress media blobs
      // even when the meta version doesn't indicate it.
      const decompressed = tryZstdDecompress(data);
      if (decompressed) data = decompressed;
      results.push({
        filename: entry.filename,
        data,
        mimeType: entry.mimeType,
      });
    } catch {
      // Individual blob unreadable — skip, don't fail the batch
    }
  }

  return results;
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
// New-schema helpers (Anki 2.1.50+ / collection.anki21b)
// ---------------------------------------------------------------------------

/**
 * Check whether the database uses the newer Anki schema with separate
 * `notetypes`, `fields`, and `templates` tables instead of the legacy
 * `col.models` JSON blob.
 *
 * @param db - Open sql.js Database.
 * @returns `true` if the `notetypes` table exists.
 */
export function hasNewSchema(db: Database): boolean {
  const result = db.exec(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='notetypes'",
  );
  const first = result[0];
  return !!first && first.values.length > 0;
}

/**
 * Decode a single protobuf field 3 (length-delimited string) from a raw
 * `NoteTypeConfig` protobuf blob. Field 3 contains the CSS stylesheet.
 *
 * Protobuf wire format refresher:
 *   tag byte = (fieldNumber << 3) | wireType
 *   wireType 2 = length-delimited (varint length + bytes)
 *
 * @param blob - Raw protobuf bytes from the notetypes.config column.
 * @returns The CSS string, or empty string if field 3 is absent.
 */
export function extractCssFromProtobuf(blob: Uint8Array): string {
  let offset = 0;

  /** Read a varint at the current offset, advancing `offset`. */
  const readVarint = (): number => {
    let value = 0;
    let shift = 0;
    while (offset < blob.length) {
      const byte = blob[offset]!;
      offset++;
      value |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return value;
      shift += 7;
    }
    return value;
  };

  while (offset < blob.length) {
    const tag = readVarint();
    const fieldNumber = tag >>> 3;
    const wireType = tag & 0x07;

    if (wireType === 2) {
      // Length-delimited
      const length = readVarint();
      if (fieldNumber === 3) {
        const cssBytes = blob.slice(offset, offset + length);
        return new TextDecoder().decode(cssBytes);
      }
      offset += length;
    } else if (wireType === 0) {
      // Varint — consume it
      readVarint();
    } else if (wireType === 5) {
      // 32-bit fixed
      offset += 4;
    } else if (wireType === 1) {
      // 64-bit fixed
      offset += 8;
    } else {
      // Unknown wire type — bail out
      break;
    }
  }

  return '';
}

/**
 * Extract note types from the new Anki schema (`notetypes`, `fields`,
 * `templates` tables).
 *
 * @param db - Open sql.js Database using the new schema.
 * @returns Array of ParsedNoteType.
 */
export function extractNoteTypesNewSchema(db: Database): ParsedNoteType[] {
  // --- note types ---
  const ntRows = db.exec('SELECT id, name, config FROM notetypes');
  const ntFirst = ntRows[0];
  if (!ntFirst || ntFirst.values.length === 0) return [];

  /** Map from notetype id -> partial ParsedNoteType (fields/templates filled below) */
  const noteTypeMap = new Map<string, ParsedNoteType>();
  for (const row of ntFirst.values as Row[]) {
    const id = String(row[0]);
    const name = String(row[1] ?? '');
    const configBlob = row[2];
    const css =
      configBlob instanceof Uint8Array
        ? extractCssFromProtobuf(configBlob)
        : '';
    noteTypeMap.set(id, { id, name, fields: [], templates: [], css });
  }

  // --- fields ---
  const fldRows = db.exec('SELECT ntid, ord, name FROM fields ORDER BY ntid, ord');
  const fldFirst = fldRows[0];
  if (fldFirst) {
    for (const row of fldFirst.values as Row[]) {
      const ntid = String(row[0]);
      const fieldName = String(row[2] ?? '');
      const nt = noteTypeMap.get(ntid);
      if (nt) {
        nt.fields.push(fieldName);
      }
    }
  }

  // --- templates ---
  // In some Anki versions qfmt/afmt are TEXT columns; in others they're
  // inside the protobuf config blob. Try with columns first, fall back
  // to config-only.
  const hasQfmtColumn = tableHasColumn(db, 'templates', 'qfmt');

  if (hasQfmtColumn) {
    const tmplRows = db.exec(
      'SELECT ntid, ord, name, qfmt, afmt FROM templates ORDER BY ntid, ord',
    );
    const tmplFirst = tmplRows[0];
    if (tmplFirst) {
      for (const row of tmplFirst.values as Row[]) {
        const ntid = String(row[0]);
        const nt = noteTypeMap.get(ntid);
        if (nt) {
          nt.templates.push({
            name: String(row[2] ?? ''),
            ord: Number(row[1] ?? 0),
            qfmt: String(row[3] ?? ''),
            afmt: String(row[4] ?? ''),
          });
        }
      }
    }
  } else {
    // qfmt/afmt are inside the protobuf config blob
    const tmplRows = db.exec(
      'SELECT ntid, ord, name, config FROM templates ORDER BY ntid, ord',
    );
    const tmplFirst = tmplRows[0];
    if (tmplFirst) {
      for (const row of tmplFirst.values as Row[]) {
        const ntid = String(row[0]);
        const nt = noteTypeMap.get(ntid);
        if (nt) {
          const configBlob = row[3];
          const { qfmt, afmt } =
            configBlob instanceof Uint8Array
              ? extractTemplateFromProtobuf(configBlob)
              : { qfmt: '', afmt: '' };
          nt.templates.push({
            name: String(row[2] ?? ''),
            ord: Number(row[1] ?? 0),
            qfmt,
            afmt,
          });
        }
      }
    }
  }

  return Array.from(noteTypeMap.values());
}

/**
 * Extract decks from the new Anki schema (`decks` table with `id`, `name`,
 * `common` columns).
 *
 * @param db - Open sql.js Database using the new schema.
 * @returns Array of ParsedAnkiDeck.
 */
export function extractDecksNewSchema(db: Database): ParsedAnkiDeck[] {
  const rows = db.exec('SELECT id, name FROM decks');
  const first = rows[0];
  if (!first || first.values.length === 0) return [];

  return (first.values as Row[]).map((row) => ({
    id: String(row[0]),
    name: String(row[1] ?? ''),
    description: '',
  }));
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Anki SqlValue row type (columns are string-keyed). */
type Row = (number | string | null | Uint8Array | bigint)[];

/**
 * Try to open the first valid SQLite database from a list of ZIP entry names.
 *
 * Some Anki versions write `collection.anki21b` as pure protobuf (not SQLite).
 * This function gracefully skips non-SQLite entries and returns the first one
 * that opens successfully.
 *
 * @param zip        - Loaded JSZip instance.
 * @param SQL        - Initialized sql.js module.
 * @param candidates - Ordered list of ZIP entry names to try.
 * @returns The opened Database and entry name, or null db if none worked.
 */
async function openFirstDatabase(
  zip: JSZip,
  SQL: Awaited<ReturnType<typeof initSqlJs>>,
  candidates: string[],
): Promise<{ db: Database | null; dbName: string }> {
  let hadAnki21b = false;

  for (const name of candidates) {
    const entry = zip.file(name);
    if (!entry) continue;

    if (name === 'collection.anki21b') hadAnki21b = true;

    try {
      let bytes = await entry.async('uint8array');

      // Try opening as-is first; if that fails and this is anki21b,
      // try zstd decompression (newer Anki exports compress the DB).
      let db: Database;
      try {
        db = new SQL.Database(bytes);
        db.exec('SELECT 1');
      } catch {
        // Possibly zstd-compressed — try decompressing
        const decompressed = tryZstdDecompress(bytes);
        if (!decompressed) throw new Error('not a database');
        bytes = decompressed;
        db = new SQL.Database(bytes);
        db.exec('SELECT 1');
      }

      // If we skipped anki21b and fell back to anki2, check for stub DB.
      // Newer Anki exports include a fake collection.anki2 with a single
      // "please update" note — the real data is in anki21b (protobuf).
      if (hadAnki21b && name !== 'collection.anki21b' && isStubDatabase(db)) {
        db.close();
        return { db: null, dbName: 'stub' };
      }

      return { db, dbName: name };
    } catch {
      // Not a valid SQLite file even after decompression — try next candidate
    }
  }
  return { db: null, dbName: '' };
}

/**
 * Check whether a table has a specific column.
 *
 * @param db    - Open sql.js Database.
 * @param table - Table name.
 * @param col   - Column name to check for.
 * @returns True if the column exists.
 */
function tableHasColumn(db: Database, table: string, col: string): boolean {
  try {
    const result = db.exec(`PRAGMA table_info('${table}')`);
    const first = result[0];
    if (!first) return false;
    const nameIdx = first.columns.indexOf('name');
    return first.values.some((row) => String(row[nameIdx]) === col);
  } catch {
    return false;
  }
}

/**
 * Extract qfmt and afmt from a CardTemplateConfig protobuf blob.
 *
 * Protobuf schema (from Anki source):
 *   message CardTemplateConfig {
 *     string qfmt = 1;  // tag 0x0a
 *     string afmt = 2;  // tag 0x12
 *     ...
 *   }
 *
 * @param blob - Raw protobuf bytes from templates.config column.
 * @returns The question and answer format strings.
 */
function extractTemplateFromProtobuf(blob: Uint8Array): { qfmt: string; afmt: string } {
  let offset = 0;
  let qfmt = '';
  let afmt = '';

  const readVarint = (): number => {
    let value = 0;
    let shift = 0;
    while (offset < blob.length) {
      const byte = blob[offset]!;
      offset++;
      value |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return value;
      shift += 7;
    }
    return value;
  };

  while (offset < blob.length) {
    const tag = readVarint();
    const fieldNumber = tag >>> 3;
    const wireType = tag & 0x07;

    if (wireType === 2) {
      const length = readVarint();
      if (fieldNumber === 1) {
        qfmt = new TextDecoder().decode(blob.slice(offset, offset + length));
      } else if (fieldNumber === 2) {
        afmt = new TextDecoder().decode(blob.slice(offset, offset + length));
      }
      offset += length;
    } else if (wireType === 0) {
      readVarint();
    } else if (wireType === 5) {
      offset += 4;
    } else if (wireType === 1) {
      offset += 8;
    } else {
      break;
    }
  }

  return { qfmt, afmt };
}

/**
 * Attempt zstd decompression of a buffer.
 *
 * @param data - Possibly zstd-compressed bytes.
 * @returns Decompressed bytes, or null if decompression fails.
 */
function tryZstdDecompress(data: Uint8Array): Uint8Array | null {
  // Zstd magic number: 0x28 0xB5 0x2F 0xFD
  if (data.length < 4 || data[0] !== 0x28 || data[1] !== 0xB5 || data[2] !== 0x2F || data[3] !== 0xFD) {
    return null;
  }
  try {
    return zstdDecompress(data);
  } catch {
    return null;
  }
}

/**
 * Read the `meta` protobuf file from the ZIP to determine the package version.
 *
 * Anki's `PackageMeta` protobuf:
 *   message PackageMeta { uint32 version = 1; }
 *
 * - version 0: no compression
 * - version 1: database is zstd-compressed
 * - version 2: database AND media blobs are zstd-compressed
 *
 * @param zip - Loaded JSZip instance.
 * @returns The package version number, or 0 if no meta file.
 */
async function readMetaVersion(zip: JSZip): Promise<number> {
  const metaEntry = zip.file('meta');
  if (!metaEntry) return 0;

  try {
    const bytes = await metaEntry.async('uint8array');
    if (bytes.length === 0) return 0;

    // Parse protobuf field 1 (varint): tag = (1 << 3 | 0) = 0x08
    if (bytes[0] === 0x08 && bytes.length >= 2) {
      return bytes[1]!;
    }
    return 0;
  } catch {
    return 0;
  }
}

/**
 * Detect Anki's stub "please update" database.
 *
 * Newer Anki exports include a fake collection.anki2 containing a single
 * note whose content tells users to update Anki. We detect this by checking
 * if the notes table has exactly one row with "update" and "Anki" in the fields.
 *
 * @param db - Open sql.js Database.
 * @returns True if this is a stub placeholder database.
 */
function isStubDatabase(db: Database): boolean {
  try {
    const result = db.exec('SELECT flds FROM notes');
    const first = result[0];
    if (!first || first.values.length !== 1) return false;
    const row = first.values[0] as Row;
    const flds = String(row[0] ?? '');
    return flds.includes('update') && flds.includes('Anki');
  } catch {
    return false;
  }
}

/**
 * Extract note types and decks from a collection database, auto-detecting
 * whether it uses the new schema (separate tables) or legacy schema (JSON in col).
 *
 * @param db     - Open sql.js Database.
 * @param dbName - ZIP entry name (used for diagnostics only).
 * @returns Note types and decks, or an error.
 */
function extractStructure(
  db: Database,
  _dbName: string,
): Result<{ noteTypes: ParsedNoteType[]; decks: ParsedAnkiDeck[] }> {
  if (hasNewSchema(db)) {
    // New schema (Anki 2.1.50+): notetypes/fields/templates tables
    let noteTypes: ParsedNoteType[];
    let decks: ParsedAnkiDeck[];
    try {
      noteTypes = extractNoteTypesNewSchema(db);
    } catch (e) {
      return { success: false, error: `Could not parse note types: ${String(e)}` };
    }
    try {
      decks = extractDecksNewSchema(db);
    } catch (e) {
      return { success: false, error: `Could not parse decks: ${String(e)}` };
    }
    return { success: true, data: { noteTypes, decks } };
  }

  // Legacy schema: col.models / col.decks JSON blobs
  const colRows = db.exec('SELECT models, decks FROM col LIMIT 1');
  const firstRow = colRows[0];
  if (!colRows.length || !firstRow || !firstRow.values.length) {
    return { success: false, error: 'Collection table is empty or corrupt' };
  }

  const [modelsJson, decksJson] = firstRow.values[0] as [string, string];

  let noteTypes: ParsedNoteType[];
  let decks: ParsedAnkiDeck[];
  try {
    noteTypes = parseNoteTypesJson(modelsJson);
  } catch (e) {
    return { success: false, error: `Could not parse note types: ${String(e)}` };
  }
  try {
    decks = parseDecksJson(decksJson);
  } catch (e) {
    return { success: false, error: `Could not parse decks: ${String(e)}` };
  }

  return { success: true, data: { noteTypes, decks } };
}

/**
 * Build a lightweight media manifest from the ZIP's `media` JSON file.
 * Returns metadata only — no binary data is extracted.
 *
 * @param zip - Loaded JSZip instance.
 * @returns Manifest entries sorted by zip key.
 */
async function buildMediaManifest(zip: JSZip): Promise<MediaManifestEntry[]> {
  const mediaEntry = zip.file('media');
  if (mediaEntry) {
    // Get the raw bytes first — needed for both JSON and protobuf paths
    const rawBytes = await mediaEntry.async('uint8array');

    // Decompress if zstd-compressed
    const bytes = tryZstdDecompress(rawBytes) ?? rawBytes;

    // Try JSON manifest first (older Anki format: {"0": "filename.png", ...})
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        const mapping = parsed as Record<string, string>;
        const entries = Object.entries(mapping).map(([zipKey, filename]) => ({
          zipKey,
          filename,
          mimeType: guessMimeType(filename),
        }));
        if (entries.length > 0) return entries;
      }
    } catch {
      // Not JSON — try protobuf
    }

    // Try protobuf manifest (newer Anki: repeated MediaEntry messages)
    // message MediaEntries { repeated MediaEntry entries = 1; }
    // message MediaEntry { string name = 1; uint64 size = 2; bytes sha1 = 3; }
    // Zip keys are sequential indices: "0", "1", "2", ...
    try {
      const entries = parseMediaProtobuf(bytes);
      if (entries.length > 0) return entries;
    } catch {
      // Fall through to ZIP scan
    }
  }

  // Fallback: scan the ZIP for numbered files (0, 1, 2, …) that aren't
  // known structural files. This handles cases where the media manifest
  // is missing or empty but media blobs are present.
  const results: MediaManifestEntry[] = [];
  const skipNames = new Set([
    'media', 'meta', 'collection.anki2', 'collection.anki21',
    'collection.anki21b',
  ]);
  zip.forEach((relativePath, file) => {
    if (file.dir || skipNames.has(relativePath)) return;
    if (/^\d+$/.test(relativePath)) {
      results.push({
        zipKey: relativePath,
        filename: relativePath,
        mimeType: 'application/octet-stream',
      });
    }
  });
  return results;
}

/**
 * Parse the protobuf-format media manifest used by newer Anki exports.
 *
 * Wire format:
 *   repeated field 1 (MediaEntry, length-delimited):
 *     field 1: string name (the real filename)
 *     field 2: varint size
 *     field 3: bytes sha1 hash
 *
 * The zip key for entry N is simply its 0-based index as a string ("0", "1", ...).
 *
 * @param data - Raw (decompressed) protobuf bytes.
 * @returns Array of manifest entries.
 */
function parseMediaProtobuf(data: Uint8Array): MediaManifestEntry[] {
  const entries: MediaManifestEntry[] = [];
  let pos = 0;
  let index = 0;

  while (pos < data.length) {
    // Read tag byte
    const tag = data[pos]!;
    pos++;
    const fieldNum = tag >> 3;
    const wireType = tag & 0x07;

    if (wireType === 2) {
      // Length-delimited: read varint length, then bytes
      let length = 0;
      let shift = 0;
      while (pos < data.length) {
        const b = data[pos]!;
        pos++;
        length |= (b & 0x7f) << shift;
        shift += 7;
        if (!(b & 0x80)) break;
      }
      const sub = data.subarray(pos, pos + length);
      pos += length;

      if (fieldNum === 1) {
        // This is a MediaEntry sub-message — extract the filename
        const filename = parseMediaEntryFilename(sub);
        if (filename) {
          entries.push({
            zipKey: String(index),
            filename,
            mimeType: guessMimeType(filename),
          });
        }
        index++;
      }
    } else if (wireType === 0) {
      // Varint: skip
      while (pos < data.length && (data[pos]! & 0x80)) pos++;
      pos++;
    } else {
      // Unknown wire type — bail
      break;
    }
  }

  return entries;
}

/**
 * Extract the filename (field 1) from a MediaEntry protobuf sub-message.
 *
 * @param sub - Raw bytes of the sub-message.
 * @returns The filename string, or null if not found.
 */
function parseMediaEntryFilename(sub: Uint8Array): string | null {
  let pos = 0;
  while (pos < sub.length) {
    const tag = sub[pos]!;
    pos++;
    const fieldNum = tag >> 3;
    const wireType = tag & 0x07;

    if (wireType === 2) {
      let length = 0;
      let shift = 0;
      while (pos < sub.length) {
        const b = sub[pos]!;
        pos++;
        length |= (b & 0x7f) << shift;
        shift += 7;
        if (!(b & 0x80)) break;
      }
      const val = sub.subarray(pos, pos + length);
      pos += length;

      if (fieldNum === 1) {
        return new TextDecoder().decode(val);
      }
    } else if (wireType === 0) {
      while (pos < sub.length && (sub[pos]! & 0x80)) pos++;
      pos++;
    } else {
      break;
    }
  }
  return null;
}

/**
 * Extract all notes from the open collection database.
 * Fields are split on the \x1f separator.
 *
 * @param db - Open sql.js Database (caller is responsible for closing).
 * @returns All notes in the collection.
 */
function extractNotes(db: Database): ParsedNote[] {
  const results = db.exec('SELECT id, mid, tags, flds FROM notes');
  const first = results[0];
  if (!results.length || !first) return [];

  const { columns, values } = first;
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
  const first = results[0];
  if (!results.length || !first) return [];

  const { columns, values } = first;
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
