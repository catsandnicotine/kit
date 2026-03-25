/**
 * Home page — deck list with card counts and import button.
 *
 * Layout:
 *  ┌──────────────────────────┐
 *  │  [cat + KitLogo] [gear]  │
 *  │  ● New  ● Learning ● Due│
 *  ├──────────────────────────┤
 *  │  deck list               │
 *  │    deck name   N  L  R   │
 *  │    ┈┈┈┈┈🐱┈┈┈┈┈┈┈       │
 *  │    …                     │
 *  ├──────────────────────────┤
 *  │  [ Import Deck ]         │
 *  └──────────────────────────┘
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Database } from 'sql.js';
import type { Deck } from '../types';
import { useDeckImport } from '../hooks/useDeckImport';
import { useExport } from '../hooks/useExport';
import { useDeckThumbnails } from '../hooks/useDeckThumbnails';
import type { ImportPhase } from '../hooks/useDeckImport';
import {
  getAllDecks,
  getAllDeckCardCounts,
  insertDeck,
  renameDeck,
  deleteDeck,
  type DeckCardCounts,
} from '../lib/db/queries';
import { v4 as uuidv4 } from 'uuid';
import { persistDatabase } from '../hooks/useDatabase';
import { scheduleICloudBackup } from '../hooks/useBackup';
import { hapticTap, hapticNavigate, hapticAgain } from '../lib/platform/haptics';
import { pickApkgFile, pickImageFile } from '../lib/platform/filePicker';
import { PixelCat } from '../components/PixelCat';
import { KitLogo } from '../components/KitLogo';
import { ThumbnailCropper } from '../components/ThumbnailCropper';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface HomeProps {
  db: Database | null;
  dbLoading: boolean;
  dbError: string;
  onStudy: (deckId: string, deckName: string) => void;
  onBrowse: (deckId: string, deckName: string) => void;
  onStats: (deckId: string, deckName: string) => void;
  onDeckSettings: (deckId: string, deckName: string) => void;
  onSettings: () => void;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Inline SVG ellipsis-in-circle icon (~22px). */
function DotsCircleIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <circle cx="8" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="16" cy="12" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}

const COUNT_COLOR_MAP: Record<string, string> = {
  blue: 'text-blue-500 dark:text-blue-400',
  orange: 'text-red-500 dark:text-red-400',
  green: 'text-green-500 dark:text-green-400',
};

const IMPORT_LABELS: Record<string, string> = {
  parsing: 'Parsing .apkg file…',
  'storing-cards': 'Storing cards — this may take a moment for large decks…',
  'storing-media': 'Storing media files…',
};

/** Count badge with a colour. */
function CountBadge({
  count,
  color,
  label,
}: {
  count: number;
  color: 'blue' | 'orange' | 'green';
  label: string;
}) {
  return (
    <span
      className={`text-sm font-semibold tabular-nums ${COUNT_COLOR_MAP[color]}`}
      title={label}
    >
      {count}
    </span>
  );
}

/** Count legend row: ● New  ● Learning  ● Due */
function CountLegend() {
  return (
    <div className="flex items-center justify-end gap-4 text-xs text-[#C4C4C4] px-4 py-1.5">
      <span className="flex items-center gap-1">
        <span className="w-1.5 h-1.5 rounded-full bg-blue-500 dark:bg-blue-400 inline-block" />
        New
      </span>
      <span className="flex items-center gap-1">
        <span className="w-1.5 h-1.5 rounded-full bg-red-500 dark:bg-red-400 inline-block" />
        Learning
      </span>
      <span className="flex items-center gap-1">
        <span className="w-1.5 h-1.5 rounded-full bg-green-500 dark:bg-green-400 inline-block" />
        Due
      </span>
    </div>
  );
}

/** Action menu for a deck row — "..." button that opens a dropdown. */
function DeckActionMenu({
  onRename,
  onBrowse,
  onStats,
  onDeckSettings,
  onExport,
  onSetThumbnail,
  onDelete,
  exporting,
}: {
  onRename: () => void;
  onBrowse: () => void;
  onStats: () => void;
  onDeckSettings: () => void;
  onExport: () => void;
  onSetThumbnail: () => void;
  onDelete: () => void;
  exporting: boolean;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside tap
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [open]);

  return (
    <div ref={menuRef} className="relative shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="px-3 py-3 text-sm text-[#C4C4C4] hover:text-[#1c1c1e] dark:hover:text-[#E5E5E5] transition-colors"
        aria-label="Deck actions"
      >
        ···
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-10 min-w-[160px] bg-[#FDFBF7] dark:bg-[#1A1A1A] border border-[#E5E5E5] dark:border-[#333] rounded-lg shadow-lg overflow-hidden">
          <button
            onClick={() => { setOpen(false); onRename(); }}
            className="w-full text-left px-4 py-3 text-sm text-[#1c1c1e] dark:text-[#E5E5E5] active:bg-[#F0F0F0] dark:active:bg-[#262626] transition-colors"
          >
            Rename
          </button>
          <button
            onClick={() => { setOpen(false); onBrowse(); }}
            className="w-full text-left px-4 py-3 text-sm text-[#1c1c1e] dark:text-[#E5E5E5] active:bg-[#F0F0F0] dark:active:bg-[#262626] transition-colors border-t border-[#E5E5E5] dark:border-[#333]"
          >
            Browse Cards
          </button>
          <button
            onClick={() => { setOpen(false); onStats(); }}
            className="w-full text-left px-4 py-3 text-sm text-[#1c1c1e] dark:text-[#E5E5E5] active:bg-[#F0F0F0] dark:active:bg-[#262626] transition-colors border-t border-[#E5E5E5] dark:border-[#333]"
          >
            Statistics
          </button>
          <button
            onClick={() => { setOpen(false); onDeckSettings(); }}
            className="w-full text-left px-4 py-3 text-sm text-[#1c1c1e] dark:text-[#E5E5E5] active:bg-[#F0F0F0] dark:active:bg-[#262626] transition-colors border-t border-[#E5E5E5] dark:border-[#333]"
          >
            Settings
          </button>
          <button
            onClick={() => { setOpen(false); onSetThumbnail(); }}
            className="w-full text-left px-4 py-3 text-sm text-[#1c1c1e] dark:text-[#E5E5E5] active:bg-[#F0F0F0] dark:active:bg-[#262626] transition-colors border-t border-[#E5E5E5] dark:border-[#333]"
          >
            Set Thumbnail
          </button>
          <button
            onClick={() => { setOpen(false); onExport(); }}
            disabled={exporting}
            className="w-full text-left px-4 py-3 text-sm text-[#1c1c1e] dark:text-[#E5E5E5] active:bg-[#F0F0F0] dark:active:bg-[#262626] transition-colors border-t border-[#E5E5E5] dark:border-[#333] disabled:opacity-40"
          >
            {exporting ? 'Exporting…' : 'Export .apkg'}
          </button>
          <button
            onClick={() => { setOpen(false); onDelete(); }}
            className="w-full text-left px-4 py-3 text-sm text-red-500 active:bg-red-50 dark:active:bg-red-950 transition-colors border-t border-[#E5E5E5] dark:border-[#333]"
          >
            Delete Deck
          </button>
        </div>
      )}
    </div>
  );
}

/** A single deck row in the list with progress bar and MiniCat. */
function DeckRow({
  deck,
  counts,
  thumbnail,
  onTap,
  onBrowse,
  onStats,
  onDeckSettings,
  onExport,
  onRename,
  onSetThumbnail,
  onDelete,
  exporting,
}: {
  deck: Deck;
  counts: DeckCardCounts | undefined;
  thumbnail: string | undefined;
  onTap: () => void;
  onBrowse: () => void;
  onStats: () => void;
  onDeckSettings: () => void;
  onExport: () => void;
  onRename: (newName: string) => void;
  onSetThumbnail: () => void;
  onDelete: () => void;
  exporting: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(deck.name);
  const inputRef = useRef<HTMLInputElement>(null);

  const newCount = counts?.newCount ?? 0;
  const learningCount = counts?.learningCount ?? 0;
  const reviewCount = counts?.reviewCount ?? 0;
  const totalCount = counts?.totalCount ?? 0;
  const dueCount = newCount + learningCount + reviewCount;
  const progress = totalCount > 0 ? (totalCount - dueCount) / totalCount : 0;

  const startRename = useCallback(() => {
    setDraftName(deck.name);
    setEditing(true);
  }, [deck.name]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const commitRename = useCallback(() => {
    const trimmed = draftName.trim();
    if (trimmed && trimmed !== deck.name) {
      onRename(trimmed);
    }
    setEditing(false);
  }, [draftName, deck.name, onRename]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitRename();
      } else if (e.key === 'Escape') {
        setEditing(false);
      }
    },
    [commitRename],
  );

  return (
    <div className="border-b border-[#E5E5E5] dark:border-[#262626]">
      <div className="flex items-center">
        {editing ? (
          <div className="flex-1 px-4 py-3 flex items-center gap-2 min-w-0">
            <input
              ref={inputRef}
              type="text"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onBlur={commitRename}
              onKeyDown={handleKeyDown}
              className="flex-1 text-sm font-medium bg-transparent border-b border-[#1c1c1e] dark:border-[#E5E5E5] outline-none text-[#1c1c1e] dark:text-[#E5E5E5] min-w-0"
            />
          </div>
        ) : (
          <button
            onClick={onTap}
            className="flex-1 text-left px-4 py-3 flex items-center active:bg-[#F0F0F0] dark:active:bg-[#1A1A1A] transition-colors min-w-0 gap-3"
          >
            {/* Thumbnail */}
            {thumbnail ? (
              <img
                src={thumbnail}
                alt=""
                className="w-10 h-10 rounded-lg object-cover shrink-0"
              />
            ) : null}
            <div className="flex flex-col gap-0.5 min-w-0 flex-1">
              <span className="text-sm font-semibold text-[#1c1c1e] dark:text-[#E5E5E5] truncate">
                {deck.name}
              </span>
              <span className="text-xs text-[#C4C4C4]">
                {totalCount} {totalCount === 1 ? 'card' : 'cards'}
              </span>
            </div>
            <div className="flex items-center gap-3 ml-4 shrink-0">
              <CountBadge count={newCount} color="blue" label="New" />
              <CountBadge count={learningCount} color="orange" label="Learning" />
              <CountBadge count={reviewCount} color="green" label="Review" />
            </div>
          </button>
        )}
        <DeckActionMenu
          onRename={startRename}
          onBrowse={onBrowse}
          onStats={onStats}
          onDeckSettings={onDeckSettings}
          onExport={onExport}
          onSetThumbnail={onSetThumbnail}
          onDelete={onDelete}
          exporting={exporting}
        />
      </div>

      {/* Progress bar */}
      {totalCount > 0 && (
        <div className="px-4 pb-2 pt-0.5">
          <div className="deck-progress-track bg-[#E5E5E5] dark:bg-[#262626] w-full">
            <div
              className="deck-progress-fill bg-[#1c1c1e] dark:bg-[#E5E5E5]"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/** Progress indicator shown during import. */
function ImportProgress({ phase }: { phase: ImportPhase }) {
  const label = IMPORT_LABELS[phase];
  if (!label) return null;

  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="w-4 h-4 border-2 border-[#1c1c1e] dark:border-[#E5E5E5] border-t-transparent rounded-full animate-spin" />
      <span className="text-sm text-[#C4C4C4]">{label}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * Home page showing all decks with card counts and an import button.
 *
 * @param db        - sql.js Database instance (null while loading).
 * @param dbLoading - True while the database is initialising.
 * @param dbError   - Non-empty string if DB init failed.
 * @param onStudy   - Called when the user taps a deck to study.
 */
export default function Home({ db, dbLoading, dbError, onStudy, onBrowse, onStats, onDeckSettings, onSettings }: HomeProps) {
  const [decks, setDecks] = useState<Deck[] | null>(null);
  const [counts, setCounts] = useState<Record<string, DeckCardCounts>>({});
  const [catBouncing, setCatBouncing] = useState(false);

  // Thumbnail state
  const deckIds = useMemo(() => (decks ?? []).map(d => d.id), [decks]);
  const { thumbnails, setThumbnail } = useDeckThumbnails(deckIds);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [cropDeckId, setCropDeckId] = useState<string | null>(null);

  // ── Load / refresh deck list ──────────────────────────────────────────
  const refreshDecks = useCallback(() => {
    if (!db) return;
    const now = Math.floor(Date.now() / 1000);

    const decksResult = getAllDecks(db);
    if (decksResult.success) setDecks(decksResult.data);

    const countsResult = getAllDeckCardCounts(db, now);
    if (countsResult.success) setCounts(countsResult.data);
  }, [db]);

  useEffect(() => {
    refreshDecks();
  }, [refreshDecks]);

  // ── Import hook ───────────────────────────────────────────────────────
  const onImportComplete = useCallback(() => {
    refreshDecks();
  }, [refreshDecks]);

  const { phase: importPhase, errorMessage: importError, importInfo, importFile, reset: resetImport } =
    useDeckImport(db, onImportComplete);

  // ── Export hook ──────────────────────────────────────────────────────
  const { phase: exportPhase, errorMessage: exportError, exportDeck, reset: resetExport } =
    useExport(db);

  const isExporting = exportPhase === 'exporting';

  // ── Rename handler ──────────────────────────────────────────────────
  const handleRename = useCallback(
    (deckId: string, newName: string) => {
      if (!db) return;
      const now = Math.floor(Date.now() / 1000);
      const result = renameDeck(db, deckId, newName, now);
      if (result.success) {
        persistDatabase();
        scheduleICloudBackup();
        refreshDecks();
      }
    },
    [db, refreshDecks],
  );

  // ── Create deck handler ────────────────────────────────────────────
  const [showCreateDeck, setShowCreateDeck] = useState(false);
  const [newDeckName, setNewDeckName] = useState('');
  const createInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showCreateDeck) createInputRef.current?.focus();
  }, [showCreateDeck]);

  const handleCreateDeck = useCallback(() => {
    if (!db) return;
    const name = newDeckName.trim();
    if (!name) return;
    const now = Math.floor(Date.now() / 1000);
    const deck = { id: uuidv4(), name, description: '', createdAt: now, updatedAt: now };
    const result = insertDeck(db, deck);
    if (result.success) {
      persistDatabase();
      scheduleICloudBackup();
      refreshDecks();
      setShowCreateDeck(false);
      setNewDeckName('');
      hapticTap();
      onBrowse(deck.id, deck.name);
    }
  }, [db, newDeckName, refreshDecks, onBrowse]);

  // ── Delete handler ──────────────────────────────────────────────────
  const [deletingDeck, setDeletingDeck] = useState<{ id: string; name: string } | null>(null);

  const handleDeleteRequest = useCallback((deckId: string, deckName: string) => {
    hapticAgain();
    setDeletingDeck({ id: deckId, name: deckName });
  }, []);

  const handleDeleteConfirm = useCallback(() => {
    if (!db || !deletingDeck) return;
    const result = deleteDeck(db, deletingDeck.id);
    if (result.success) {
      persistDatabase();
      scheduleICloudBackup();
      refreshDecks();
    }
    setDeletingDeck(null);
  }, [db, deletingDeck, refreshDecks]);

  // ── Import using native file picker ────────────────────────────────
  const openFilePicker = useCallback(async () => {
    if (importPhase !== 'idle' && importPhase !== 'done' && importPhase !== 'error') return;
    if (importPhase === 'done' || importPhase === 'error') resetImport();
    hapticTap();
    const file = await pickApkgFile();
    if (file) importFile(file);
  }, [importPhase, resetImport, importFile]);

  // ── Thumbnail handling ────────────────────────────────────────────────
  const handleSetThumbnail = useCallback(async (deckId: string) => {
    hapticTap();
    const file = await pickImageFile();
    if (file) {
      setCropDeckId(deckId);
      setCropFile(file);
    }
  }, []);

  const handleCropSave = useCallback(async (base64: string) => {
    if (cropDeckId) {
      await setThumbnail(cropDeckId, base64);
    }
    setCropFile(null);
    setCropDeckId(null);
  }, [cropDeckId, setThumbnail]);

  const handleCropCancel = useCallback(() => {
    setCropFile(null);
    setCropDeckId(null);
  }, []);

  // ── Cat bounce ────────────────────────────────────────────────────────
  const handleCatTap = useCallback(() => {
    hapticTap();
    setCatBouncing(true);
  }, []);

  // ── Importing state ───────────────────────────────────────────────────
  const isImporting =
    importPhase === 'parsing' ||
    importPhase === 'storing-cards' ||
    importPhase === 'storing-media';

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="min-h-[100dvh] bg-[var(--kit-bg)] text-[#1c1c1e] dark:text-[#E5E5E5] flex flex-col">
      {/* Header */}
      <header
        className="flex items-center justify-between pb-3 border-b border-[#E5E5E5] dark:border-[#262626] shrink-0"
        style={{
          paddingTop: 'env(safe-area-inset-top)',
          paddingLeft: 'max(1rem, env(safe-area-inset-left))',
          paddingRight: 'max(1rem, env(safe-area-inset-right))',
        }}
      >
        <div className="flex items-center gap-2">
          <button
            onClick={handleCatTap}
            className="p-0.5"
            aria-label="Kit mascot"
          >
            <div
              className={catBouncing ? 'cat-bounce' : ''}
              onAnimationEnd={() => setCatBouncing(false)}
            >
              <PixelCat size={16} />
            </div>
          </button>
          <KitLogo height={16} />
        </div>
        <button
          onClick={() => { hapticNavigate(); onSettings(); }}
          className="p-2 text-[#C4C4C4] hover:text-[#1c1c1e] dark:hover:text-[#E5E5E5] transition-colors"
          aria-label="Settings"
        >
          <DotsCircleIcon />
        </button>
      </header>

      {/* Count legend */}
      {decks && decks.length > 0 && <CountLegend />}

      {/* DB status */}
      {dbLoading && (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 py-12">
          <div className="cat-bounce" style={{ animationIterationCount: 'infinite' }}>
            <PixelCat size={48} />
          </div>
          <p className="text-xs text-[#C4C4C4]">Loading…</p>
        </div>
      )}
      {dbError && (
        <div className="px-4 py-4">
          <p className="text-xs text-red-500">{dbError}</p>
        </div>
      )}

      {/* Deck list */}
      {!dbLoading && !dbError && decks !== null && (
        <div className="flex flex-col flex-1 min-h-0 overflow-auto">
          {decks.length === 0 && importPhase === 'idle' && (
            <div className="px-4 py-12 text-center flex flex-col items-center gap-4">
              <PixelCat size={80} className="opacity-30" />
              <div>
                <p className="text-sm text-[#C4C4C4]">No decks yet</p>
                <p className="text-xs text-[#C4C4C4] mt-1">
                  Import an Anki .apkg file to get started
                </p>
              </div>
            </div>
          )}

          {decks.map((deck) => (
            <DeckRow
              key={deck.id}
              deck={deck}
              counts={counts[deck.id]}
              thumbnail={thumbnails[deck.id]}
              onTap={() => { hapticNavigate(); onStudy(deck.id, deck.name); }}
              onBrowse={() => { hapticNavigate(); onBrowse(deck.id, deck.name); }}
              onStats={() => { hapticNavigate(); onStats(deck.id, deck.name); }}
              onDeckSettings={() => { hapticNavigate(); onDeckSettings(deck.id, deck.name); }}
              onExport={() => { hapticTap(); exportDeck(deck.id, deck.name); }}
              onRename={(newName: string) => handleRename(deck.id, newName)}
              onSetThumbnail={() => handleSetThumbnail(deck.id)}
              onDelete={() => handleDeleteRequest(deck.id, deck.name)}
              exporting={isExporting}
            />
          ))}
        </div>
      )}

      {/* Import progress */}
      {isImporting && <ImportProgress phase={importPhase} />}

      {/* Import success */}
      {importPhase === 'done' && (
        <div className="px-4 py-3">
          <p className="text-sm text-green-600 dark:text-green-400">
            Deck imported successfully!{importInfo ? ` (${importInfo})` : ''}
          </p>
        </div>
      )}

      {/* Import error */}
      {importPhase === 'error' && importError && (
        <div className="px-4 py-3 flex flex-col gap-2">
          <p className="text-sm text-red-500">{importError}</p>
          <button
            onClick={resetImport}
            className="text-xs text-[#C4C4C4] underline self-start"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Export status */}
      {exportPhase === 'exporting' && (
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="w-4 h-4 border-2 border-[#1c1c1e] dark:border-[#E5E5E5] border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-[#C4C4C4]">Exporting deck…</span>
        </div>
      )}
      {exportPhase === 'done' && (
        <div className="px-4 py-3 flex items-center justify-between">
          <p className="text-sm text-green-600 dark:text-green-400">Deck exported!</p>
          <button onClick={resetExport} className="text-xs text-[#C4C4C4] underline">Dismiss</button>
        </div>
      )}
      {exportPhase === 'error' && exportError && (
        <div className="px-4 py-3 flex flex-col gap-2">
          <p className="text-sm text-red-500">{exportError}</p>
          <button onClick={resetExport} className="text-xs text-[#C4C4C4] underline self-start">Dismiss</button>
        </div>
      )}

      {/* Bottom buttons */}
      <div
        className="px-4 py-4 shrink-0 flex flex-col gap-2"
        style={{
          paddingBottom: 'max(1rem, env(safe-area-inset-bottom))',
          paddingLeft: 'max(1rem, env(safe-area-inset-left))',
          paddingRight: 'max(1rem, env(safe-area-inset-right))',
        }}
      >
        <button
          disabled={dbLoading || !!dbError}
          onClick={() => { hapticTap(); setShowCreateDeck(true); }}
          className="w-full py-3 text-sm font-semibold bg-[#1c1c1e] dark:bg-[#E5E5E5] text-white dark:text-[#0A0A0A] rounded-lg disabled:opacity-40 disabled:cursor-not-allowed active:opacity-80 transition-opacity"
        >
          Create Deck
        </button>
        <button
          disabled={dbLoading || !!dbError || isImporting}
          onClick={openFilePicker}
          className="w-full py-3 text-sm font-semibold border border-[#D4D4D4] dark:border-[#404040] rounded-lg text-[#1c1c1e] dark:text-[#E5E5E5] disabled:opacity-40 disabled:cursor-not-allowed active:bg-[#F0F0F0] dark:active:bg-[#1A1A1A] transition-colors"
        >
          {isImporting ? 'Importing\u2026' : 'Import Deck'}
        </button>
      </div>

      {/* Delete confirmation dialog */}
      {deletingDeck && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-8">
          <div className="bg-[#FDFBF7] dark:bg-[#1A1A1A] rounded-2xl w-full max-w-sm overflow-hidden">
            <div className="px-6 pt-5 pb-4 text-center">
              <p className="text-base font-semibold text-[#1c1c1e] dark:text-[#E5E5E5]">
                Delete "{deletingDeck.name}"?
              </p>
              <p className="text-sm text-[#C4C4C4] mt-2">
                All cards, review history, and media will be permanently deleted.
              </p>
            </div>
            <div className="flex border-t border-[#E5E5E5] dark:border-[#333]">
              <button
                onClick={() => setDeletingDeck(null)}
                className="flex-1 py-3.5 text-sm font-medium text-[#1c1c1e] dark:text-[#E5E5E5] active:bg-[#F0F0F0] dark:active:bg-[#262626] border-r border-[#E5E5E5] dark:border-[#333]"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteConfirm}
                className="flex-1 py-3.5 text-sm font-semibold text-red-500 active:bg-red-50 dark:active:bg-red-950"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create deck dialog */}
      {showCreateDeck && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-8">
          <div className="bg-[#FDFBF7] dark:bg-[#1A1A1A] rounded-2xl w-full max-w-sm overflow-hidden">
            <div className="px-6 pt-5 pb-4">
              <p className="text-base font-semibold text-[#1c1c1e] dark:text-[#E5E5E5] text-center">
                Create Deck
              </p>
              <input
                ref={createInputRef}
                type="text"
                value={newDeckName}
                onChange={(e) => setNewDeckName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreateDeck(); }}
                placeholder="Deck name"
                className="w-full mt-4 px-3 py-2.5 text-sm bg-[#F0F0F0] dark:bg-[#262626] border border-[#D4D4D4] dark:border-[#404040] rounded-lg text-[#1c1c1e] dark:text-[#E5E5E5] outline-none"
              />
            </div>
            <div className="flex border-t border-[#E5E5E5] dark:border-[#333]">
              <button
                onClick={() => { setShowCreateDeck(false); setNewDeckName(''); }}
                className="flex-1 py-3.5 text-sm font-medium text-[#1c1c1e] dark:text-[#E5E5E5] active:bg-[#F0F0F0] dark:active:bg-[#262626] border-r border-[#E5E5E5] dark:border-[#333]"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateDeck}
                disabled={!newDeckName.trim()}
                className="flex-1 py-3.5 text-sm font-semibold text-[#1c1c1e] dark:text-[#E5E5E5] active:bg-[#F0F0F0] dark:active:bg-[#262626] disabled:opacity-40"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Thumbnail cropper overlay */}
      {cropFile && (
        <ThumbnailCropper
          file={cropFile}
          onSave={handleCropSave}
          onCancel={handleCropCancel}
        />
      )}
    </div>
  );
}
