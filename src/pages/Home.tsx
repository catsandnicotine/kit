import { DeckName } from '../components/DeckName';
/**
 * Home page — deck list with card counts and import button.
 *
 * The inline connection row sits between the toolbar and deck list.
 */

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Database } from 'sql.js';
import type { Deck } from '../types';
import { useDeckImport } from '../hooks/useDeckImport';
import { useDeckThumbnails } from '../hooks/useDeckThumbnails';
import type { ImportPhase } from '../hooks/useDeckImport';
import {
  getAllDecks,
  getAllDeckCardCounts,
  insertDeck,
  searchDecksByTagLike,
  type DeckCardCounts,
} from '../lib/db/queries';
import { persistAndBackup } from '../hooks/useDatabase';
import { hapticTap, hapticNavigate } from '../lib/platform/haptics';
import { pickApkgFile } from '../lib/platform/filePicker';
import { DeckCreationScreen } from '../components/DeckCreationScreen';
import { DeckEntryChoices } from '../components/DeckEntryChoices';
import { ImportConflictDialog } from '../components/ImportConflictDialog';
import { TabBar } from '../components/TabBar';
import { KitHeader } from '../components/KitHeader';
import { LibraryDock } from '../components/LibraryDock';
import { useVisibleViewport } from '../hooks/useVisibleViewport';
import { useNativeLibraryControls } from '../hooks/useNativeLibraryControls';
import { useTheme } from '../hooks/useTheme';
import { useLibrarySwipe } from '../hooks/useLibrarySwipe';
import { LIBRARY_SWIPE_SETTLE_MS } from '../lib/librarySwipe';
import { useLibrarySearch } from '../hooks/useLibrarySearch';
import type { AppMode } from '../App';
import { createEmptyDeckSnapshot } from '../lib/db/deckFactory';
import { LibraryNotice } from '../components/LibraryNotice';
import { getLibraryNotice } from '../lib/libraryNotice';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface HomeProps {
  connectionNotice: ReactNode;
  db: Database | null;
  dbLoading: boolean;
  dbError: string;
  /** Per-deck registry entries (new sync architecture). */
  deckEntries?: import('../lib/sync/types').DeckRegistryEntry[];
  /** Deck manager for per-deck operations (new sync architecture). */
  deckManager?: import('../hooks/useDeckManager').UseDeckManagerReturn;
  /** Current app mode (learn vs review). */
  mode: AppMode;
  /** Called when user switches tabs. */
  onModeChange: (mode: AppMode) => void;
  onStudy: (deckId: string, deckName: string) => void;
  onReviewStudy: (deckId: string, deckName: string) => void;
  onManage: (deckId: string, deckName: string, guideFirstCard?: boolean) => Promise<boolean>;
  onSettings: () => void;
  /** File opened externally via iOS "Open in" / share sheet. */
  pendingFile?: File | null;
  /** Called after the pending file has been handed to the import pipeline. */
  onPendingFileConsumed?: () => void;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------


const IMPORT_LABELS: Record<string, string> = {
  parsing: 'Opening deck…',
  'storing-cards': 'Saving cards…',
  'storing-media': 'Saving pictures & audio…',
};


/** A compact deck row; opening cards and less common actions live in its menu. */
function DeckRow({ deck, counts, thumbnail, matchedTag, mode, failed, onTap, onManage }: {
  deck: Deck;
  counts: DeckCardCounts | undefined;
  thumbnail: string | undefined;
  matchedTag?: string;
  mode: AppMode;
  failed: boolean;
  onTap: () => void;
  onManage: () => void;
}) {
  const newCount = counts?.newCount ?? 0;
  const learningCount = counts?.learningCount ?? 0;
  const reviewCount = counts?.reviewCount ?? 0;
  const totalCount = counts?.totalCount ?? 0;

  return (
    <div className={`library-deck-row ${failed ? 'opacity-60' : ''}`}>
      <div className="library-deck-row-content">
        <button
          onClick={onTap}
          className="library-deck-open"
          aria-label={`${failed ? 'Recover' : mode === 'review' ? 'Practice' : 'Study'} ${deck.name}`}
        >
          {/* Thumbnail */}
          {thumbnail ? (
            <img
              src={thumbnail}
              alt=""
              className="library-deck-thumbnail"
            />
          ) : null}
          <div className="flex flex-col gap-0.5 min-w-0 flex-1">
            <DeckName name={deck.name} className="library-deck-title" />
            {(matchedTag || totalCount === 0) && <span className="library-deck-subtitle">
              {matchedTag ? `Contains: ${matchedTag}` : 'No cards'}
            </span>}
          </div>
          {mode === 'learn' && totalCount > 0 && (
            <div className="library-deck-counts" aria-label={`${newCount} new, ${learningCount} learning, ${reviewCount} due`}>
              {newCount > 0 && <span className="kit-count--new">{newCount}</span>}
              {learningCount > 0 && <span className="kit-count--learning">{learningCount}</span>}
              {reviewCount > 0 && <span className="kit-count--review">{reviewCount}</span>}
              {newCount + learningCount + reviewCount === 0 && <span className="library-deck-subtitle">0</span>}
            </div>
          )}
          {mode === 'review' && totalCount > 0 && (
            <span className="library-deck-total">
              {totalCount}
            </span>
          )}
        </button>
        <button type="button" className="kit-icon-button library-deck-actions" onClick={onManage} aria-label={`Manage ${deck.name}`} title="Manage deck"><span aria-hidden="true">···</span></button>
      </div>


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
export default function Home({ connectionNotice, db, dbLoading, dbError, deckEntries, deckManager, mode, onModeChange, onStudy, onReviewStudy, onManage, onSettings, pendingFile, onPendingFileConsumed }: HomeProps) {
  /** True when using the new per-deck architecture. */
  const useNewArch = !!(deckEntries && deckManager);

  const [legacyDecks, setDecks] = useState<Deck[] | null>(null);
  const [legacyCounts, setCounts] = useState<Record<string, DeckCardCounts>>({});
  const decks = useMemo(() => useNewArch && deckEntries ? deckEntries.map(entry => ({
    id: entry.deckId, name: entry.name || 'Untitled', description: '', createdAt: 0, updatedAt: entry.lastAccessedAt,
  })) : legacyDecks, [useNewArch, deckEntries, legacyDecks]);
  const counts = useMemo<Record<string, DeckCardCounts>>(() => useNewArch && deckEntries ? Object.fromEntries(deckEntries.map(entry => [entry.deckId, {
    deckId: entry.deckId, newCount: entry.newCount ?? 0, learningCount: entry.learningCount ?? 0,
    reviewCount: entry.reviewCount ?? 0, totalCount: entry.cardCount,
  }])) : legacyCounts, [useNewArch, deckEntries, legacyCounts]);
  const isLibraryLoading = (dbLoading || decks === null) && !dbError;

  // Search state
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const librarySwipe = useLibrarySwipe(mode, onModeChange, !isLibraryLoading && !searchOpen);
  const closeSearch = useCallback((clearQuery = true) => {
    searchInputRef.current?.blur();
    setSearchOpen(false);
    if (clearQuery) setSearchQuery('');
  }, []);

  // Thumbnail state
  const deckIds = useMemo(() => (decks ?? []).map(d => d.id), [decks]);
  const { thumbnails } = useDeckThumbnails(deckIds);

  // Filtered + sorted deck list (with optional tag-match subtitles)
  const filteredDecks = useMemo(() => {
    const allDecks = decks ?? [];
    const q = searchQuery.trim().toLowerCase();

    let nameMatched: { deck: Deck; matchedTag?: string }[];
    const tagMatchedExtras: { deck: Deck; matchedTag: string }[] = [];

    if (q) {
      nameMatched = allDecks
        .filter(d => d.name.toLowerCase().includes(q))
        .map(deck => ({ deck }));

      // Tag search only available with monolithic DB (new arch doesn't have a global DB)
      if (db && !useNewArch) {
        const tagResult = searchDecksByTagLike(db, q);
        if (tagResult.success) {
          const nameMatchedIds = new Set(nameMatched.map(r => r.deck.id));
          for (const { deckId, matchedTag } of tagResult.data) {
            if (!nameMatchedIds.has(deckId)) {
              const deck = allDecks.find(d => d.id === deckId);
              if (deck) tagMatchedExtras.push({ deck, matchedTag });
            }
          }
        }
      }
    } else {
      nameMatched = allDecks.map(deck => ({ deck }));
    }

    const combined = [...nameMatched, ...tagMatchedExtras];

    combined.sort((a, b) => a.deck.name.localeCompare(b.deck.name));

    return combined;
  }, [db, useNewArch, decks, searchQuery]);
  // ── Load / refresh deck list ──────────────────────────────────────────
  const refreshDecks = useCallback(() => {
    if (useNewArch) {
      // New arch: refresh from deck manager which re-reads registry + iCloud
      deckManager.refreshDecks();
      return;
    }
    if (!db) return;
    const now = Math.floor(Date.now() / 1000);

    const decksResult = getAllDecks(db);
    if (decksResult.success) setDecks(decksResult.data);

    const countsResult = getAllDeckCardCounts(db, now);
    if (countsResult.success) setCounts(countsResult.data);
  }, [useNewArch, deckManager, db]);

  useEffect(() => {
    if (!useNewArch) refreshDecks();
  }, [useNewArch, refreshDecks]);

  // ── Import hook ───────────────────────────────────────────────────────
  const onImportComplete = useCallback(() => {
    refreshDecks();
  }, [refreshDecks]);

  const { phase: importPhase, errorMessage: importError, conflictInfo, importFile, resolveConflict, reset: resetImport } =
    useDeckImport(db, onImportComplete, deckManager);

  // ── Import toast ─────────────────────────────────────────────────────
  const [importToast, setImportToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    if (importPhase === 'done') {
      setImportToast({ type: 'success', message: 'Imported' });
    } else if (importPhase === 'error' && importError) {
      setImportToast({ type: 'error', message: importError });
    }
  }, [importPhase, importError, resetImport]);

  // ── Create deck handler ────────────────────────────────────────────
  const [showCreateDeck, setShowCreateDeck] = useState(false);
  const [createDeckStep, setCreateDeckStep] = useState<'choose' | 'name'>('choose');
  const [creatingDeck, setCreatingDeck] = useState(false);
  const [createDeckError, setCreateDeckError] = useState<string | null>(null);
  const createdDeckForEditing = useRef<Pick<Deck, 'id' | 'name'> | null>(null);

  const handleCreateDeck = useCallback(async (name: string) => {
    if (creatingDeck) return;
    setCreatingDeck(true);
    setCreateDeckError(null);
    try {
      let deck = createdDeckForEditing.current;
      if (!deck) {
        const snapshot = createEmptyDeckSnapshot(name);
        deck = snapshot.deck;
        if (useNewArch) {
          const newDb = await deckManager.createFromSnapshot(snapshot);
          if (!newDb) throw new Error('Kit could not create that deck.');
          await deckManager.saveRegistry();
          await deckManager.refreshDecks();
        } else {
          if (!db) throw new Error('Database not ready.');
          const result = insertDeck(db, snapshot.deck);
          if (!result.success) throw new Error(result.error);
          persistAndBackup();
          refreshDecks();
        }
        createdDeckForEditing.current = deck;
        hapticTap();
      }
      const opened = await onManage(deck.id, deck.name, true);
      if (!opened) throw new Error('Your deck is saved. Try opening the first card again.');
      // Keep this screen busy until Browse replaces Home, avoiding a library flash.
    } catch (cause) {
      setCreateDeckError(cause instanceof Error ? cause.message : 'Could not create that deck.');
      setCreatingDeck(false);
    }
  }, [useNewArch, deckManager, db, refreshDecks, onManage, creatingDeck]);

  /**
   * Deck whose last open attempt failed, chosen by the user to recover.
   * Opens the recovery sheet ("Try Again" / "Remove from this device").
   */
  const [recoveringDeck, setRecoveringDeck] = useState<{ id: string; name: string } | null>(null);

  const handleRetryDeck = useCallback(async () => {
    if (!recoveringDeck || !deckManager) return;
    hapticTap();
    // openDeckDb clears the failed flag internally on success.
    const retryDb = await deckManager.openDeckDb(recoveringDeck.id);
    if (retryDb) {
      setRecoveringDeck(null);
      if (mode === 'review') onReviewStudy(recoveringDeck.id, recoveringDeck.name);
      else onStudy(recoveringDeck.id, recoveringDeck.name);
    }
    // If it still failed, leave the sheet open so the user can try again
    // or choose to remove the local copy.
  }, [recoveringDeck, deckManager, mode, onReviewStudy, onStudy]);

  // ── Import using native file picker ────────────────────────────────
  const openFilePicker = useCallback(async () => {
    if (importPhase !== 'idle' && importPhase !== 'done' && importPhase !== 'error') return;
    if (importPhase === 'done' || importPhase === 'error') resetImport();
    hapticTap();
    const file = await pickApkgFile();
    if (file) {
      setImportToast(null);
      void importFile(file);
    }
  }, [importPhase, resetImport, importFile]);

  // ── Auto-import file opened externally (iOS "Open in") ──────────────
  useEffect(() => {
    if (!pendingFile || dbLoading || dbError) return;
    if (importPhase !== 'idle' && importPhase !== 'done' && importPhase !== 'error') return;
    if (importPhase === 'done' || importPhase === 'error') resetImport();
    setImportToast(null);
    void importFile(pendingFile);
    onPendingFileConsumed?.();
  }, [pendingFile, dbLoading, dbError, importPhase, resetImport, importFile, onPendingFileConsumed]);

  // ── Importing state ───────────────────────────────────────────────────
  const isImporting =
    importPhase === 'parsing' ||
    importPhase === 'storing-cards' ||
    importPhase === 'storing-media';

  const libraryNotice = getLibraryNotice({ libraryError: dbError, importNotice: importToast, exportPhase:'idle', exportError:'', mediaPhase:'idle', mediaMessage:null });
  const dismissLibraryNotice = () => {
    if (libraryNotice?.source === 'import') {
      setImportToast(null);
      resetImport();
    }
  };

  const dockActions = {
    onSearch: () => {
          hapticTap();
          setSearchOpen(value => { if (value) setSearchQuery(''); return !value; });
    },
    onSettings: () => { closeSearch(); hapticNavigate(); onSettings(); },
    onAdd: () => {
          closeSearch();
          hapticTap();
          createdDeckForEditing.current = null;
          setCreateDeckStep('choose');
          setCreateDeckError(null);
          setShowCreateDeck(true);
    },
  };

  const { resolvedTheme } = useTheme();
  const dockAddDisabled = dbLoading || !!dbError || creatingDeck;
  const libraryControlsVisible = !isLibraryLoading && !showCreateDeck && !recoveringDeck && importPhase !== 'duplicate-found' && !isImporting;
  useEffect(() => { if (!libraryControlsVisible) closeSearch(); }, [libraryControlsVisible, closeSearch]);
  const nativeLayout = useNativeLibraryControls({
    ...dockActions,
    visible: libraryControlsVisible,
    onSearchChange: (open, query) => {
      if (open) hapticTap();
      setSearchQuery(query);
      setSearchOpen(open);
    },
    searchOpen,
    searchQuery,
    onQuery: setSearchQuery,
    addDisabled: dockAddDisabled,
    appearance: resolvedTheme,
  });

  const nativeDock = nativeLayout.ready;
  const searchPresentation = useLibrarySearch({ open:searchOpen, native:nativeDock, onClose:() => closeSearch(false) });
  const searchViewportHeight = useVisibleViewport(searchOpen && !nativeDock);
  useEffect(() => {
    if (searchOpen && !nativeDock) searchInputRef.current?.focus();
  }, [searchOpen, nativeDock]);

  // ── Render ────────────────────────────────────────────────────────────

  // Full-screen loading splash — shown until db/registry is ready AND decks have loaded.
  // Completely separate from the normal layout so no header/buttons flash through.
  if (isLibraryLoading) {
    return (
      <div className="min-h-[100dvh] bg-[var(--kit-bg)] flex flex-col items-center justify-center gap-3">
        <p className="text-xs font-semibold tracking-widest text-[#1c1c1e] dark:text-[#E5E5E5] uppercase">
          Kit
        </p>
        <div className="kit-loading-bar mt-1">
          <div className="kit-loading-fill" />
        </div>
      </div>
    );
  }

  return (
    <div className="h-[100dvh] overflow-hidden bg-[var(--kit-bg)] text-[#1c1c1e] dark:text-[#E5E5E5] flex flex-col" style={nativeDock ? {
      height: `calc(100dvh - ${nativeLayout.keyboardInset}px)`,
      transition: `height ${nativeLayout.keyboardDuration}ms cubic-bezier(.2,.8,.2,1)`,
    } : searchViewportHeight ? { height:searchViewportHeight } : undefined}>
      {/* Header */}
      <KitHeader />

      {libraryNotice ? <LibraryNotice key={`${libraryNotice.source}:${libraryNotice.tone}:${libraryNotice.details}`} notice={libraryNotice}
        {...(libraryNotice.source !== 'library' && libraryNotice.tone !== 'progress' ? { onDismiss: dismissLibraryNotice } : {})} /> : connectionNotice}

      {/* Main content area — swipeable to switch Learn / Review */}
      <div
        ref={librarySwipe.contentRef}
        onTouchStart={librarySwipe.onTouchStart}
        onTouchEnd={librarySwipe.onTouchEnd}
        onTouchCancel={librarySwipe.onTouchCancel}
        onClickCapture={librarySwipe.onClickCapture}
        className="library-swipe-area flex flex-col flex-1 min-h-0 overflow-auto"
        style={{
          paddingBottom: '12px',
          transform: librarySwipe.offset ? `translateX(${librarySwipe.offset}px)` : undefined,
          transition: librarySwipe.returning ? `transform ${LIBRARY_SWIPE_SETTLE_MS}ms ease-out` : undefined,
          willChange: librarySwipe.offset ? 'transform' : undefined,
        }}
      >
        {!dbError && (
          <div className={`library-deck-list library-deck-list--${mode}`}>
            {decks!.length === 0 && (importPhase === 'idle' || importPhase === 'error' || importPhase === 'done') && !searchQuery && (
              <div className="library-empty-entry">
                <DeckEntryChoices onCreate={() => {
                  hapticTap();
                  createdDeckForEditing.current = null;
                  setCreateDeckStep('name');
                  setCreateDeckError(null);
                  setShowCreateDeck(true);
                }} onImport={() => { void openFilePicker(); }} />
              </div>
            )}
            {filteredDecks.length === 0 && searchQuery.trim() && (
              <div className="px-4 py-12 text-center">
                <p className="text-sm text-[#C4C4C4]">No decks match "{searchQuery}"</p>
              </div>
            )}
            {filteredDecks.map(({ deck, matchedTag }) => {
              const isFailed = deckManager?.failedDeckIds.has(deck.id) ?? false;
              return (
                <DeckRow
                  key={deck.id}
                  deck={deck}
                  counts={counts[deck.id]}
                  thumbnail={thumbnails[deck.id]}
                  mode={mode}
                  failed={isFailed}
                  {...(matchedTag !== undefined && { matchedTag })}
                  onTap={() => {
                    if (isFailed) {
                      hapticTap();
                      setRecoveringDeck({ id: deck.id, name: deck.name });
                    } else {
                      hapticNavigate();
                      if ((counts[deck.id]?.totalCount ?? 0) === 0) {
                        onManage(deck.id, deck.name, true);
                      } else if (mode === 'review') {
                        onReviewStudy(deck.id, deck.name);
                      } else {
                        onStudy(deck.id, deck.name);
                      }
                    }
                  }}
                  onManage={() => { if (isFailed) setRecoveringDeck({ id:deck.id, name:deck.name }); else { hapticNavigate(); void onManage(deck.id, deck.name); } }}
                />
              );
            })}
          </div>
        )}
      </div>

      <footer className="library-bottom-area">
      {/* Browser fallback; iPhone input and keyboard move together in UIKit. */}
      {searchPresentation.mounted && (
        <div
          id="library-search"
          className={`library-search-ribbon ${searchPresentation.closing ? 'search-collapse' : 'search-expand'}`}
          aria-hidden={searchPresentation.closing || undefined}
          inert={searchPresentation.closing || undefined}
        >
          <div className="flex items-center gap-2">
          {!nativeDock && <input
            ref={searchInputRef}
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search decks…"
            className="flex-1 px-4 py-2 text-base bg-[var(--kit-surface)] rounded-full text-[#1c1c1e] dark:text-[#E5E5E5] placeholder-[#C4C4C4] outline-none"
          />}

          </div>
        </div>
      )}

        {!dbLoading && !dbError && decks!.length > 0 && <TabBar mode={mode} onChange={librarySwipe.changeMode} pageProgress={librarySwipe.pageProgress} returning={librarySwipe.returning} />}
        <LibraryDock {...dockActions} searchOpen={searchOpen} searchFiltered={Boolean(searchQuery.trim())} addDisabled={dockAddDisabled} native={nativeDock} keyboardRaised={nativeLayout.keyboardInset > 0} />
      </footer>

      {/* Import progress */}
      {isImporting && <ImportProgress phase={importPhase} />}

      {/* Duplicate import dialog */}
      {importPhase === 'duplicate-found' && conflictInfo && <ImportConflictDialog
        deckName={conflictInfo.deckName}
        canReplace={conflictInfo.canReplace}
        onKeepBoth={() => { hapticTap(); resolveConflict('new'); }}
        onReplace={() => { hapticTap(); resolveConflict('replace'); }}
        onCancel={() => { hapticTap(); resetImport(); }}
      />}

      {/* Delete confirmation dialog */}
      {showCreateDeck && (
        <DeckCreationScreen
          initialStep={createDeckStep}
          nameLocked={createdDeckForEditing.current !== null}
          creating={creatingDeck}
          error={createDeckError}
          onImport={() => {
            setShowCreateDeck(false);
            void openFilePicker();
          }}
          onCreate={name => { void handleCreateDeck(name); }}
          onCancel={() => {
            if (creatingDeck) return;
            createdDeckForEditing.current = null;
            setShowCreateDeck(false);
            setCreateDeckError(null);
          }}
        />
      )}

      {/* Deck-couldn't-load recovery sheet — reserved for the genuinely rare
          case where both local and iCloud copies can't produce a usable DB.
          Copy avoids "error"/"failed"/"corrupted" — those read as alarming
          and are usually inaccurate (this is almost always recoverable). */}
      {recoveringDeck && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-8">
          <div className="bg-[#FDFBF7] dark:bg-[#1A1A1A] rounded-2xl w-full max-w-sm overflow-hidden">
            <div className="px-6 pt-5 pb-4 text-center">
              <p className="text-base font-semibold text-[#1c1c1e] dark:text-[#E5E5E5]">
                This deck didn't load
              </p>
              <p className="text-sm text-[#C4C4C4] mt-2">
                Kit couldn’t open this deck. Try again; your local files have been kept.
              </p>
            </div>
            <div className="flex flex-col border-t border-[#E5E5E5] dark:border-[#333]">
              <button
                onClick={handleRetryDeck}
                className="py-3.5 text-sm font-semibold text-[#1c1c1e] dark:text-[#E5E5E5] active:bg-[#F0F0F0] dark:active:bg-[#262626] border-b border-[#E5E5E5] dark:border-[#333]"
              >
                Try Again
              </button>

              <button
                onClick={() => setRecoveringDeck(null)}
                className="py-3.5 text-sm text-[#C4C4C4] active:bg-[#F0F0F0] dark:active:bg-[#262626]"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}


    </div>
  );
}
