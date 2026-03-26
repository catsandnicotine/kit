/**
 * useDeckImport — state machine for importing an Anki .apkg file.
 *
 * Phases: idle → parsing → storing-cards → storing-media → done | error
 *
 * Performance design for 30K+ card decks with 1-2 GB media:
 *  - All bulk inserts are wrapped in a single SQL transaction (BEGIN/COMMIT).
 *    Without this, SQLite auto-commits after every INSERT (30K fsyncs → minutes).
 *  - Media blobs are extracted from the ZIP in batches of 50, so only ~50 blobs
 *    are in memory at once instead of the full 1-2 GB.
 *  - Note lookups use a Map (O(1)) instead of Array.find (O(n) per card = O(n²)).
 *  - Rendered templates are cached per (noteId, templateOrd) so identical cards
 *    aren't re-rendered.
 */

import { useCallback, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { Database } from 'sql.js';
import type { Card, CardState, Deck, Media, Note, NoteType, Result, ReviewLog } from '../types';
import { parseApkgLazy, extractMediaBatch } from '../lib/apkg';
import { renderTemplate } from '../lib/apkg/templateRenderer';
import type {
  ParsedApkgLazy,
  ParsedNote,
  ParsedNoteType,
} from '../lib/apkg/parser';
import {
  beginTransaction,
  commitTransaction,
  rollbackTransaction,
  insertCard,
  insertDeck,
  insertMedia,
  insertNote,
  insertNoteType,
  insertReviewLog,
  setCardState,
} from '../lib/db/queries';
import { hapticCelebration } from '../lib/platform/haptics';
import { persistDatabase } from './useDatabase';
import { scheduleICloudBackup } from './useBackup';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ImportPhase =
  | 'idle'
  | 'parsing'
  | 'storing-cards'
  | 'storing-media'
  | 'done'
  | 'error';

export interface UseDeckImportReturn {
  /** Current phase of the import pipeline. */
  phase: ImportPhase;
  /** User-friendly error message when phase is 'error'. */
  errorMessage: string;
  /** Summary of what was imported (shown on success). */
  importInfo: string;
  /** Start importing a .apkg File. */
  importFile: (file: File) => Promise<void>;
  /** Reset back to idle so the user can import again. */
  reset: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Number of media blobs to extract and insert per batch. */
const MEDIA_BATCH_SIZE = 50;

// ---------------------------------------------------------------------------
// kit_progress.json shape
// ---------------------------------------------------------------------------

interface KitProgressData {
  version: number;
  statesByContent: Record<string, CardState>;
  logsByContent: Record<string, ReviewLog[]>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Hook that drives the .apkg import pipeline.
 *
 * @param db         - sql.js Database instance (null while loading).
 * @param onComplete - Called after a successful import with the new deck ID.
 * @returns Import state and actions.
 */
export function useDeckImport(
  db: Database | null,
  onComplete?: (deckId: string) => void,
): UseDeckImportReturn {
  const [phase, setPhase] = useState<ImportPhase>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [importInfo, setImportInfo] = useState('');
  const busyRef = useRef(false);

  const reset = useCallback(() => {
    setPhase('idle');
    setErrorMessage('');
    setImportInfo('');
    busyRef.current = false;
  }, []);

  const importFile = useCallback(
    async (file: File) => {
      if (!db) {
        setPhase('error');
        setErrorMessage('Database is not ready yet. Please try again.');
        return;
      }
      if (busyRef.current) return;
      busyRef.current = true;

      try {
        // ── Phase 1: Parsing ──────────────────────────────────────────────
        // Uses parseApkgLazy so media blobs stay in the ZIP — only metadata
        // is extracted into memory.
        setPhase('parsing');
        setErrorMessage('');

        const parseResult = await parseApkgLazy(file);
        if (!parseResult.success) {
          setPhase('error');
          setErrorMessage(friendlyParseError(parseResult.error));
          busyRef.current = false;
          return;
        }

        const parsed = parseResult.data;

        // ── Phase 2: Storing cards ────────────────────────────────────────
        // Entire entity graph is inserted inside one transaction.
        // Yield to let React paint the phase indicator before blocking.
        setPhase('storing-cards');
        await new Promise((r) => setTimeout(r, 0));

        // Check for embedded Kit progress data (ignored by Anki Desktop).
        let progressData: KitProgressData | undefined;
        try {
          const progressFile = parsed.zip.file('kit_progress.json');
          if (progressFile) {
            const json = await progressFile.async('string');
            const parsed2 = JSON.parse(json) as KitProgressData;
            if (parsed2.version === 1) progressData = parsed2;
          }
        } catch {
          // Not a Kit-exported deck — silently ignore.
        }

        const storeResult = storeEntities(db, parsed, progressData);
        if (!storeResult.success) {
          setPhase('error');
          setErrorMessage(storeResult.error);
          busyRef.current = false;
          return;
        }

        const deckId = storeResult.data;

        // ── Phase 3: Storing media in batches ─────────────────────────────
        // Each batch: extract N blobs from the ZIP → insert → release.
        setPhase('storing-media');
        await new Promise((r) => setTimeout(r, 0));

        const mediaResult = await storeMediaBatched(db, parsed, deckId);
        if (!mediaResult.success) {
          setPhase('error');
          setErrorMessage(mediaResult.error);
          busyRef.current = false;
          return;
        }

        // ── Done ──────────────────────────────────────────────────────────
        const cardCount = parsed.cards.length;
        const { storedCount, totalBytes } = mediaResult.data;
        const sizeStr = totalBytes > 1024 * 1024
          ? `${(totalBytes / (1024 * 1024)).toFixed(1)} MB`
          : `${Math.round(totalBytes / 1024)} KB`;
        setImportInfo(
          storedCount > 0
            ? `${cardCount} cards, ${storedCount} media files (${sizeStr})`
            : `${cardCount} cards, no media`,
        );
        setPhase('done');
        persistDatabase();
        scheduleICloudBackup();
        hapticCelebration();
        onComplete?.(deckId);
      } catch (e) {
        setPhase('error');
        setErrorMessage(`Import failed unexpectedly: ${String(e)}`);
      } finally {
        busyRef.current = false;
      }
    },
    [db, onComplete],
  );

  return { phase, errorMessage, importInfo, importFile, reset };
}

// ---------------------------------------------------------------------------
// Internal: map parsed data → domain types and insert (in a transaction)
// ---------------------------------------------------------------------------

/**
 * Map all parsed Anki entities to Kit domain types and insert them into the DB.
 *
 * All inserts are wrapped in a single BEGIN/COMMIT transaction. This is the
 * single biggest SQLite performance win — without it, each of the 30K+
 * inserts triggers its own journal fsync, turning a 2-second import into
 * a multi-minute ordeal.
 *
 * @param db     - sql.js Database instance.
 * @param parsed - Lazily-parsed .apkg data (no media blobs in memory).
 * @returns The primary deck ID on success, or an error.
 */
function storeEntities(
  db: Database,
  parsed: ParsedApkgLazy,
  progressData?: KitProgressData,
): Result<string> {
  const txn = beginTransaction(db);
  if (!txn.success) return txn;

  try {
    const now = Math.floor(Date.now() / 1000);

    // Build ID maps: Anki numeric ID → Kit UUID
    const deckIdMap = new Map<string, string>();
    const noteTypeIdMap = new Map<string, string>();
    const noteIdMap = new Map<string, string>();

    // ── Decks ─────────────────────────────────────────────────────────────
    // Only import decks that actually have cards (skip empty parents from
    // Anki's hierarchical "A::B::C" naming scheme).
    const usedDeckIds = new Set(parsed.cards.map((c) => c.deckId));
    const decksToInsert = parsed.decks.filter((d) => usedDeckIds.has(d.id));

    // Strip hierarchical prefixes ("A::B::C" → "C"), resolving collisions
    const leafNames = resolveLeafNames(decksToInsert.map((d) => d.name));

    for (let i = 0; i < decksToInsert.length; i++) {
      const pd = decksToInsert[i]!;
      const kitId = uuidv4();
      deckIdMap.set(pd.id, kitId);

      const deck: Deck = {
        id: kitId,
        name: leafNames[i] ?? pd.name,
        description: pd.description,
        createdAt: now,
        updatedAt: now,
      };
      const r = insertDeck(db, deck);
      if (!r.success) {
        rollbackTransaction(db);
        return r;
      }
    }

    if (deckIdMap.size === 0) {
      rollbackTransaction(db);
      return { success: false, error: 'No decks found in this file.' };
    }

    const primaryDeckId =
      deckIdMap.size === 1
        ? [...deckIdMap.values()][0]!
        : [...deckIdMap.entries()].find(([ankiId]) => ankiId !== '1')?.[1] ??
          [...deckIdMap.values()][0]!;

    // ── Note types ────────────────────────────────────────────────────────
    for (const pnt of parsed.noteTypes) {
      const kitId = uuidv4();
      noteTypeIdMap.set(pnt.id, kitId);

      const noteType: NoteType = {
        id: kitId,
        deckId: primaryDeckId,
        name: pnt.name,
        fields: pnt.fields,
        templates: pnt.templates.map((t) => ({
          name: t.name,
          ord: t.ord,
          qfmt: t.qfmt,
          afmt: t.afmt,
        })),
        css: pnt.css,
        createdAt: now,
      };
      const r = insertNoteType(db, noteType);
      if (!r.success) {
        rollbackTransaction(db);
        return r;
      }
    }

    // ── Notes ─────────────────────────────────────────────────────────────
    // O(1) lookup maps — avoids O(n) Array.find per card (30K × 30K = catastrophe)
    const noteTypeByAnkiId = new Map<string, ParsedNoteType>();
    for (const pnt of parsed.noteTypes) {
      noteTypeByAnkiId.set(pnt.id, pnt);
    }

    const parsedNoteById = new Map<string, ParsedNote>();
    for (const pn of parsed.notes) {
      parsedNoteById.set(pn.id, pn);
    }

    for (const pn of parsed.notes) {
      const kitId = uuidv4();
      noteIdMap.set(pn.id, kitId);

      const kitNoteTypeId = noteTypeIdMap.get(pn.noteTypeId);
      if (!kitNoteTypeId) continue;

      const noteType = noteTypeByAnkiId.get(pn.noteTypeId);
      const fields: Record<string, string> = {};
      if (noteType) {
        for (let i = 0; i < noteType.fields.length; i++) {
          const fieldName = noteType.fields[i];
          if (fieldName !== undefined) {
            fields[fieldName] = pn.fields[i] ?? '';
          }
        }
      }

      const note: Note = {
        id: kitId,
        deckId: primaryDeckId,
        noteTypeId: kitNoteTypeId,
        fields,
        tags: pn.tags,
        createdAt: pn.createdAt || now,
        updatedAt: now,
      };
      const r = insertNote(db, note);
      if (!r.success) {
        rollbackTransaction(db);
        return r;
      }
    }

    // ── Cards ─────────────────────────────────────────────────────────────
    // Render cache: multiple cards may share the same note + template ord
    // (e.g. cards that were duplicated across sub-decks). Cache avoids
    // redundant regex/template processing.
    const renderCache = new Map<string, { front: string; back: string }>();

    for (const pc of parsed.cards) {
      const kitNoteId = noteIdMap.get(pc.noteId);
      if (!kitNoteId) continue;

      const parsedNote = parsedNoteById.get(pc.noteId);
      if (!parsedNote) continue;
      const parsedNoteType = noteTypeByAnkiId.get(parsedNote.noteTypeId);
      if (!parsedNoteType) continue;

      const kitDeckId = deckIdMap.get(pc.deckId) ?? primaryDeckId;

      // Check render cache
      const cacheKey = `${pc.noteId}:${pc.templateOrd}`;
      let front: string;
      let back: string;

      const cached = renderCache.get(cacheKey);
      if (cached) {
        front = cached.front;
        back = cached.back;
      } else {
        const rendered = renderTemplate(parsedNote, parsedNoteType, pc.templateOrd);
        if (rendered.success) {
          front = rendered.data.front;
          back = rendered.data.back;
        } else {
          front = parsedNote.fields[0] ?? '';
          back = parsedNote.fields[1] ?? '';
        }
        renderCache.set(cacheKey, { front, back });
      }

      const card: Card = {
        id: uuidv4(),
        deckId: kitDeckId,
        noteId: kitNoteId,
        front,
        back,
        tags: parsedNote.tags,
        createdAt: parsedNote.createdAt || now,
        updatedAt: now,
      };
      const r = insertCard(db, card);
      if (!r.success) {
        rollbackTransaction(db);
        return r;
      }

      // Restore FSRS state if this deck was exported from Kit with progress.
      if (progressData) {
        const contentKey = `${card.front}\x1f${card.back}`;

        const savedState = progressData.statesByContent[contentKey];
        if (savedState) {
          const stateResult = setCardState(db, { ...savedState, cardId: card.id });
          if (!stateResult.success) {
            rollbackTransaction(db);
            return stateResult;
          }
        }

        const savedLogs = progressData.logsByContent[contentKey];
        if (savedLogs) {
          for (const log of savedLogs) {
            const logResult = insertReviewLog(db, { ...log, id: uuidv4(), cardId: card.id });
            if (!logResult.success) {
              rollbackTransaction(db);
              return logResult;
            }
          }
        }
      }
    }

    const commit = commitTransaction(db);
    if (!commit.success) return commit;

    return { success: true, data: primaryDeckId };
  } catch (e) {
    rollbackTransaction(db);
    return { success: false, error: `Failed to store deck data: ${String(e)}` };
  }
}

// ---------------------------------------------------------------------------
// Internal: batched media insertion
// ---------------------------------------------------------------------------

/**
 * Extract and store media blobs in batches from the ZIP archive.
 *
 * Each batch extracts {@link MEDIA_BATCH_SIZE} blobs from the ZIP into memory,
 * inserts them into the database inside a transaction, then releases the
 * Uint8Array references so GC can reclaim the memory before the next batch.
 *
 * For a 2 GB media set with 4000 files at ~500 KB each, peak memory is
 * ~25 MB (50 × 500 KB) instead of 2 GB.
 *
 * @param db      - sql.js Database instance.
 * @param parsed  - Lazy parse result with media manifest and open ZIP.
 * @param deckId  - Kit deck UUID to associate media with.
 * @returns void on success, or an error.
 */
interface MediaStoreResult {
  storedCount: number;
  totalBytes: number;
}

async function storeMediaBatched(
  db: Database,
  parsed: ParsedApkgLazy,
  deckId: string,
): Promise<Result<MediaStoreResult>> {
  const { mediaManifest, zip, mediaIsCompressed } = parsed;
  if (mediaManifest.length === 0) {
    return { success: true, data: { storedCount: 0, totalBytes: 0 } };
  }

  const now = Math.floor(Date.now() / 1000);
  let storedCount = 0;
  let totalBytes = 0;

  // Wrap all media inserts in a single transaction
  const txn = beginTransaction(db);
  if (!txn.success) return txn;

  try {
    for (let i = 0; i < mediaManifest.length; i += MEDIA_BATCH_SIZE) {
      const batch = await extractMediaBatch(zip, mediaManifest, i, MEDIA_BATCH_SIZE, mediaIsCompressed);

      for (const pm of batch) {
        const media: Media = {
          id: uuidv4(),
          deckId,
          filename: pm.filename,
          data: pm.data,
          mimeType: pm.mimeType,
          createdAt: now,
        };
        const r = insertMedia(db, media);
        if (!r.success) {
          rollbackTransaction(db);
          return r;
        }
        storedCount++;
        totalBytes += pm.data.byteLength;
      }
      // Batch references go out of scope here → GC can reclaim blob memory
    }

    const commit = commitTransaction(db);
    if (!commit.success) return commit;

    return { success: true, data: { storedCount, totalBytes } };
  } catch (e) {
    rollbackTransaction(db);
    return { success: false, error: `Failed to store media: ${String(e)}` };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert parser error strings into user-friendly messages.
 *
 * @param raw - Raw error string from parseApkg.
 * @returns User-friendly error message.
 */
function friendlyParseError(raw: string): string {
  if (raw.includes('newer Anki') || raw.includes('protobuf') || raw.includes('compatibility')) {
    return raw; // Already user-friendly from the parser
  }
  if (raw.includes('unzip')) {
    return 'This file doesn\u2019t appear to be a valid .apkg file. Make sure you\u2019re selecting an Anki export.';
  }
  if (raw.includes('collection database')) {
    return 'No card data found inside this file. It may be an empty or corrupted Anki export.';
  }
  if (raw.includes('WASM')) {
    return 'Failed to load the database engine. Please reload the app and try again.';
  }
  return `Import error: ${raw}`;
}

/**
 * Strip Anki's hierarchical `::` prefixes from deck names, keeping the leaf.
 * If stripping creates duplicates, keep enough parent context to disambiguate.
 *
 * "A::B::C" → "C"
 * If both "A::B::Cards" and "X::Y::Cards" exist → "B > Cards" and "Y > Cards"
 *
 * @param names - Full hierarchical deck names.
 * @returns Array of display names in the same order.
 */
function resolveLeafNames(names: string[]): string[] {
  // Start with just the leaf segment
  const leaves = names.map((n) => {
    const parts = n.split('::');
    return parts[parts.length - 1]?.trim() ?? n;
  });

  // Check for duplicates and add parent context where needed
  const seen = new Map<string, number[]>();
  for (let i = 0; i < leaves.length; i++) {
    const leaf = leaves[i]!;
    const indices = seen.get(leaf) ?? [];
    indices.push(i);
    seen.set(leaf, indices);
  }

  for (const [, indices] of seen) {
    if (indices.length <= 1) continue;
    // Collision — use "Parent > Leaf" format
    for (const idx of indices) {
      const parts = names[idx]!.split('::');
      if (parts.length >= 2) {
        leaves[idx] = `${parts[parts.length - 2]!.trim()} > ${parts[parts.length - 1]!.trim()}`;
      }
    }
  }

  return leaves;
}
