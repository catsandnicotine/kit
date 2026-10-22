import { getIncomingDeckNames, resolveLeafNames } from '../lib/apkg/importDeckNames';
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
import type { Card, Deck, Note, NoteType, Result } from '../types';
import type { KitProgressData } from '../types/apkgProgress';
import { getKitCardProgress, parseKitProgress } from '../lib/apkg/kitProgress';
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
  insertNote,
  insertNoteType,
  insertReviewLog,
  setCardState,
  upsertTagColor,
  addTagToDeck,
  getExistingTagNames,
} from '../lib/db/queries';
import { getMediaReferences } from '../lib/media';
import { hapticCelebration } from '../lib/platform/haptics';
import { saveMediaFile, deleteMediaForDeck } from '../lib/platform/mediaFiles';
import { persistDatabase } from './useDatabase';
import { scheduleICloudBackup } from './useBackup';
import type { UseDeckManagerReturn } from './useDeckManager';
import { getSqlStatic } from '../lib/db/deckManager';
import type { DeckSnapshot, SyncDeckSettings } from '../lib/sync/types';
import { ALL_TABLES, ENABLE_FOREIGN_KEYS } from '../lib/db';
import { runMigrations } from '../lib/db/migrations';
import {
  getAllDecks as getAllDecksQ,
  getCardsByDeck as getCardsByDeckQ,
  getCardStatesByDeck,
  getReviewLogsByDeck,
  getNoteTypesForDeckSnapshot,
  getNotesForDeckSnapshot,
  getDeckSettings,
  getTagsForDeck,
} from '../lib/db/queries';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ImportPhase =
  | 'idle'
  | 'parsing'
  | 'duplicate-found'
  | 'storing-cards'
  | 'storing-media'
  | 'done'
  | 'error';

/** Info about an existing deck that conflicts with an incoming import. */
export interface ConflictInfo {
  /** Kit UUID of the existing deck that has the same name. */
  existingId: string;
  canReplace: boolean;
  /** Display name of the conflicting deck. */
  deckName: string;
}

export interface UseDeckImportReturn {
  /** Current phase of the import pipeline. */
  phase: ImportPhase;
  /** User-friendly error message when phase is 'error'. */
  errorMessage: string;
  /** Summary of what was imported (shown on success). */
  importInfo: string;
  /** Set when phase is 'duplicate-found'; null otherwise. */
  conflictInfo: ConflictInfo | null;
  /** Start importing a .apkg File. */
  importFile: (file: File) => Promise<void>;
  /**
   * Resolve a duplicate-found conflict.
   * 'new'     — import alongside the existing deck (keep both).
   * 'replace' — delete the existing deck, then import fresh.
   */
  resolveConflict: (action: 'new' | 'replace') => void;
  /** Reset back to idle so the user can import again. */
  reset: () => void;
}

/**
 * Persist a set of imported snapshots in order and fail on the first deck that
 * does not obtain a durable database. `onCreated` lets the caller track staged
 * decks for rollback without treating a partial result as success.
 */
export async function createImportedSnapshots(
  snapshots: DeckSnapshot[],
  createFromSnapshot: (snapshot: DeckSnapshot) => Promise<Database | null>,
  onCreated: (deckId: string) => void,
): Promise<void> {
  for (const snapshot of snapshots) {
    const createdDb = await createFromSnapshot(snapshot);
    if (!createdDb) {
      throw new Error(`Could not save imported deck "${snapshot.deck.name}" to this device.`);
    }
    onCreated(snapshot.deckId);
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Number of media blobs to extract and insert per batch. */
const MEDIA_BATCH_SIZE = 50;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Hook that drives the .apkg import pipeline.
 *
 * @param db          - sql.js Database instance (null while loading or when using new arch).
 * @param onComplete  - Called after a successful import with the new deck ID.
 * @param deckManager - Optional deck manager for per-deck architecture.
 * @returns Import state and actions.
 */
export function useDeckImport(
  db: Database | null,
  onComplete?: (deckId: string) => void,
  deckManager?: UseDeckManagerReturn,
): UseDeckImportReturn {
  const [phase, setPhase] = useState<ImportPhase>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [importInfo, setImportInfo] = useState('');
  const [conflictInfo, setConflictInfo] = useState<ConflictInfo | null>(null);
  const busyRef = useRef(false);
  // When phase === 'duplicate-found', calling this resolves the suspended Promise
  // inside importFile so the import can continue or be cancelled.
  type ConflictAction = 'new' | 'replace' | 'cancel';
  const conflictResolveRef = useRef<((action: ConflictAction) => void) | null>(null);

  const reset = useCallback(() => {
    // Cancel any suspended import that's waiting on a conflict decision.
    conflictResolveRef.current?.('cancel');
    conflictResolveRef.current = null;
    setConflictInfo(null);
    setPhase('idle');
    setErrorMessage('');
    setImportInfo('');
    busyRef.current = false;
  }, []);

  const resolveConflict = useCallback((action: 'new' | 'replace') => {
    conflictResolveRef.current?.(action);
    conflictResolveRef.current = null;
    setConflictInfo(null);
  }, []);

  const importFile = useCallback(
    async (file: File) => {
      const useNewArch = !!deckManager;
      if (!db && !useNewArch) {
        setPhase('error');
        setErrorMessage('Database is not ready yet. Please try again.');
        return;
      }
      if (busyRef.current) return;
      busyRef.current = true;

      // For new arch: create a temporary in-memory DB for import
      let tempDb: Database | null = null;
      let workDb: Database;
      let deckToReplace: { deckId: string; name: string } | null = null;
      const createdDeckIds: string[] = [];
      let importCommitted = false;

      try {
        // ── Phase 1: Parsing ──────────────────────────────────────────────
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

        // ── Duplicate deck check (new arch only) ──────────────────────────
        // Match the names of non-empty decks that will actually be created.
        if (useNewArch && deckManager && parsed.decks.length > 0) {
          const incomingNames = getIncomingDeckNames(parsed.decks, parsed.cards).map(name => name.trim().toLowerCase());
          const conflicts = deckManager.deckEntries.filter(entry => incomingNames.includes(entry.name.trim().toLowerCase()));
          const conflict = conflicts[0];

          if (conflict) {
            // Pause the import and wait for the user to decide.
            const action = await new Promise<ConflictAction>((resolve) => {
              conflictResolveRef.current = resolve;
              setConflictInfo({ existingId: conflict.deckId, deckName: conflict.name, canReplace: incomingNames.length === 1 && conflicts.length === 1 });
              setPhase('duplicate-found');
            });

            if (action === 'cancel') {
              setPhase('idle');
              busyRef.current = false;
              return;
            }

            if (action === 'replace') {
              // Stage and durably persist the replacement first. Deleting the
              // existing deck here would turn a later import/storage failure
              // into irreversible data loss.
              deckToReplace = { deckId: conflict.deckId, name: conflict.name };
            }
            // 'new' falls through and imports alongside the existing deck.
          }
        }

        // ── Phase 2: Storing cards ────────────────────────────────────────
        setPhase('storing-cards');
        await new Promise((r) => setTimeout(r, 0));

        if (useNewArch) {
          // Reuse the already-compiled SQL module from deckManager — avoids
          // a redundant WASM fetch + instantiation (~100-300ms on device).
          const SQL = getSqlStatic();
          if (!SQL) throw new Error('SQL not initialized');
          tempDb = new SQL.Database();
          tempDb.run(ENABLE_FOREIGN_KEYS);
          for (const ddl of ALL_TABLES) {
            tempDb.run(ddl);
          }
          runMigrations(tempDb);
          workDb = tempDb;
        } else {
          workDb = db!;
        }

        // Check for embedded Kit progress data
        let progressData: KitProgressData | undefined;
        const progressFile = parsed.zip.file('kit_progress.json');
        if (progressFile) {
          const progress = parseKitProgress(await progressFile.async('string'));
          if (!progress.success) throw new Error(progress.error);
          progressData = progress.data;
        }

        const storeResult = storeEntities(workDb, parsed, progressData);
        if (!storeResult.success) {
          setPhase('error');
          setErrorMessage(storeResult.error);
          busyRef.current = false;
          if (tempDb) try { tempDb.close(); } catch { /* ignore */ }
          return;
        }

        const primaryDeckId = storeResult.data;

        // ── Phase 3: Storing media in batches ─────────────────────────────
        setPhase('storing-media');
        await new Promise((r) => setTimeout(r, 0));

        const mediaResult = await storeMediaBatched(workDb, parsed, primaryDeckId);
        if (!mediaResult.success) {
          setPhase('error');
          setErrorMessage(mediaResult.error);
          busyRef.current = false;
          if (tempDb) try { tempDb.close(); } catch { /* ignore */ }
          return;
        }

        // ── New arch: build snapshots and create per-deck DBs ─────────────
        if (useNewArch && tempDb) {
          const importDb = tempDb;
          const decksResult = getAllDecksQ(importDb);
          const allDecks = decksResult.success ? decksResult.data : [];
          if (allDecks.length === 0) {
            throw new Error('The import did not produce any decks.');
          }

          const importedTags: Array<{ tag: string; color: string }> = [];
          const snapshots = allDecks.map(deck => {
            const snapshot = buildSnapshotFromTempDb(importDb, deck.id);
            if (!snapshot) {
              throw new Error(`Could not build a complete snapshot for "${deck.name}".`);
            }
            return snapshot;
          });

          await createImportedSnapshots(
            snapshots,
            deckManager.createFromSnapshot,
            deckId => createdDeckIds.push(deckId),
          );

          for (const snapshot of snapshots) {
            // Collect tags for the global catalog only after every deck has a
            // durable snapshot.
            for (const t of snapshot.tags) {
              importedTags.push(t);
            }
          }

          // Persist the complete new deck set before a requested replacement
          // removes anything. mergeImportedTags also persists the registry.
          if (importedTags.length > 0) {
            await deckManager.mergeImportedTags(importedTags);
          } else {
            await deckManager.saveRegistry();
          }
          importCommitted = true;

          if (deckToReplace) {
            await deckManager.removeDeck(deckToReplace.deckId);
            await deleteMediaForDeck(deckToReplace.deckId);
            await deckManager.saveRegistry();
          }

          await deckManager.refreshDecks();

          // Clean up temp DB
          try { tempDb.close(); } catch { /* ignore */ }
          tempDb = null;
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

        if (!useNewArch) {
          persistDatabase();
          scheduleICloudBackup();
        }

        hapticCelebration();
        onComplete?.(primaryDeckId);
      } catch (e) {
        // Before the complete registry is committed, remove any successfully
        // staged decks so a failed multi-deck import cannot leak partial state.
        if (!importCommitted && deckManager && createdDeckIds.length > 0) {
          await Promise.allSettled(createdDeckIds.map(deckId => deckManager.removeDeck(deckId)));
          await deckManager.refreshDecks();
        }
        setPhase('error');
        setErrorMessage(`Import failed unexpectedly: ${String(e)}`);
        if (tempDb) try { tempDb.close(); } catch { /* ignore */ }
      } finally {
        busyRef.current = false;
      }
    },
    [db, deckManager, onComplete],
  );

  return { phase, errorMessage, importInfo, conflictInfo, importFile, resolveConflict, reset };
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
/**
 * Resolve imported tag names against existing tags to avoid collisions.
 * If "animals" already exists, the new tag becomes "animals (2)", etc.
 *
 * @param importedTags - Unique tags from the imported deck.
 * @param existing     - Currently known tag names in tag_colors.
 * @returns Map from original tag name → resolved (possibly renamed) tag name.
 */
function resolveTagNames(importedTags: string[], existing: Set<string>): Map<string, string> {
  const resolved = new Map<string, string>();
  const claimed = new Set(existing);
  for (const tag of importedTags) {
    if (!claimed.has(tag)) {
      resolved.set(tag, tag);
      claimed.add(tag);
    } else {
      let n = 2;
      while (claimed.has(`${tag} (${n})`)) n++;
      const newName = `${tag} (${n})`;
      resolved.set(tag, newName);
      claimed.add(newName);
    }
  }
  return resolved;
}

/**
 * Stage parsed Anki cards, their source notes/models, and optional Kit history atomically.
 * @param db - Import database; shared notes may belong to its primary deck.
 * @param parsed - Parsed source collection, never modified by staging.
 * @param progressData - Optional Kit-exported states and review logs.
 * @returns The primary staged deck ID, or a storage error.
 */
export function storeEntities(
  db: Database,
  parsed: ParsedApkgLazy,
  progressData?: KitProgressData,
): Result<string> {
  // Collect unique tags from all imported notes before starting the transaction.
  const rawTags = new Set<string>();
  if (parsed.kitCardMetadata) {
    for (const card of parsed.cards) {
      const metadata = Object.hasOwn(parsed.kitCardMetadata.cardsById, card.id) ? parsed.kitCardMetadata.cardsById[card.id] : undefined;
      if (!metadata) return { success:false, error:'This file’s Kit card details do not match its cards.' };
      for (const tag of metadata.tags) rawTags.add(tag);
    }
  } else {
    for (const pn of parsed.notes) {
      for (const t of pn.tags) rawTags.add(t);
    }
  }
  const existingTagNames = getExistingTagNames(db);
  const tagRenameMap = resolveTagNames([...rawTags], existingTagNames);

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
        tags: pn.tags.map(t => tagRenameMap.get(t) ?? t),
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
        tags: (parsed.kitCardMetadata?.cardsById[pc.id]?.tags ?? parsedNote.tags).map(t => tagRenameMap.get(t) ?? t),
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
        const restored = getKitCardProgress(progressData, pc.id, card.front, card.back);
        if (!restored.success) { rollbackTransaction(db); return restored; }
        const savedState = restored.data.state;
        if (savedState) {
          const stateResult = setCardState(db, { ...savedState, cardId: card.id });
          if (!stateResult.success) {
            rollbackTransaction(db);
            return stateResult;
          }
        }

        const savedLogs = restored.data.logs;
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

    // ── Tags: create in tag_colors (greyed out) + associate with deck ─────
    for (const resolvedTag of tagRenameMap.values()) {
      upsertTagColor(db, resolvedTag, '', now);
      addTagToDeck(db, primaryDeckId, resolvedTag, now);
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

  let storedCount = 0;
  let totalBytes = 0;
  const decks = getAllDecksQ(db);
  if (!decks.success) return decks;
  const references = new Map<string, Set<string>>();
  for (const deck of decks.data) {
    const cards = getCardsByDeckQ(db, deck.id);
    if (!cards.success) return cards;
    references.set(deck.id, getMediaReferences(cards.data.map(card => card.front + card.back).join('\n')));
  }

  try {
    for (let i = 0; i < mediaManifest.length; i += MEDIA_BATCH_SIZE) {
      const batch = await extractMediaBatch(zip, mediaManifest, i, MEDIA_BATCH_SIZE, mediaIsCompressed);
      if (batch.length !== Math.min(MEDIA_BATCH_SIZE, mediaManifest.length - i)) {
        throw new Error('Some pictures or audio in this Anki file could not be read. Export the deck from Anki again with media included.');
      }

      for (const pm of batch) {
        const owners = [...references].filter(([, files]) => files.has(pm.filename)).map(([id]) => id);
        // Unreferenced resources (such as fonts used dynamically) remain with the primary deck.
        for (const owner of owners.length ? owners : [deckId]) await saveMediaFile(owner, pm.filename, pm.data);
        storedCount++;
        totalBytes += pm.data.byteLength;
      }
      // Batch references go out of scope here → GC can reclaim blob memory
    }

    return { success: true, data: { storedCount, totalBytes } };
  } catch (e) {
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
  if (raw.includes('Pictures or audio in this package could not be read')) {
    return 'Pictures or audio in this package could not be read. Export it from Anki again with media included.';
  }
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
 * Build a DeckSnapshot from a temporary in-memory database after import.
 * Used by the new per-deck architecture to create per-deck snapshots.
 *
 * @param db     - Temporary in-memory database with imported data.
 * @param deckId - The Kit deck UUID to extract.
 * @returns A DeckSnapshot, or null on failure.
 */
export function buildSnapshotFromTempDb(
  db: Database,
  deckId: string,
): DeckSnapshot | null {
  const decksResult = getAllDecksQ(db);
  if (!decksResult.success) return null;
  const deck = decksResult.data.find(d => d.id === deckId);
  if (!deck) return null;

  const cardsResult = getCardsByDeckQ(db, deckId);
  if (!cardsResult.success) return null;

  const statesResult = getCardStatesByDeck(db, deckId);
  if (!statesResult.success) return null;
  const cardStates = statesResult.data;

  const logsResult = getReviewLogsByDeck(db, deckId);
  if (!logsResult.success) return null;
  const reviewLogs = logsResult.data;

  // Anki notes and models are shared across decks. Staging keeps them under
  // the primary deck, but each independent database needs its full dependency
  // closure. Keep IDs/references intact and rehome only ownership metadata.
  const notesResult = getNotesForDeckSnapshot(db, deckId);
  if (!notesResult.success) return null;
  const notes = notesResult.data.map(note => ({ ...note, deckId }));

  const noteTypesResult = getNoteTypesForDeckSnapshot(db, deckId);
  if (!noteTypesResult.success) return null;
  const noteTypes = noteTypesResult.data.map(noteType => ({ ...noteType, deckId }));
  const noteIds = new Set(notes.map(note => note.id));
  const noteTypeIds = new Set(noteTypes.map(noteType => noteType.id));
  if (cardsResult.data.some(card => card.noteId !== null && !noteIds.has(card.noteId))
    || notes.some(note => !noteTypeIds.has(note.noteTypeId))) return null;

  const settingsResult = getDeckSettings(db, deckId);
  const settings: SyncDeckSettings = settingsResult.success
    ? {
        deckId,
        newCardsPerDay: settingsResult.data.newCardsPerDay,
        maxReviewsPerDay: settingsResult.data.maxReviewsPerDay,
        againSteps: settingsResult.data.againSteps,
        graduatingInterval: settingsResult.data.graduatingInterval,
        easyInterval: settingsResult.data.easyInterval,
        maxInterval: settingsResult.data.maxInterval,
        leechThreshold: settingsResult.data.leechThreshold,
        desiredRetention: settingsResult.data.desiredRetention,
      }
    : {
        deckId,
        newCardsPerDay: 20,
        maxReviewsPerDay: 200,
        againSteps: [1, 10],
        graduatingInterval: 1,
        easyInterval: 4,
        maxInterval: 365,
        leechThreshold: 8,
        desiredRetention: 0.9,
      };

  const tagsResult = getTagsForDeck(db, deckId);
  const tags = tagsResult.success ? tagsResult.data : [];

  return {
    v: 1,
    deckId,
    compactedThrough: '',
    mergedEditFiles: [],
    deck,
    settings,
    noteTypes,
    notes,
    cards: cardsResult.data,
    cardStates,
    reviewLogs: reviewLogs.map(log => ({
      id: log.id,
      cardId: log.cardId,
      rating: log.rating,
      reviewedAt: log.reviewedAt,
      elapsed: log.elapsed,
      scheduledDays: log.scheduledDays,
    })),
    tags: tags.map(t => ({ tag: t.tag, color: t.color ?? '' })),
    deckTags: tags.map(t => t.tag),
    deletedCardIds: [],
  };
}
