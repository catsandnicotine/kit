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
  searchDecksByTagLike,
  type DeckCardCounts,
} from '../lib/db/queries';
import { v4 as uuidv4 } from 'uuid';
import { persistAndBackup } from '../hooks/useDatabase';
import { deleteMediaForDeck } from '../lib/platform/mediaFiles';
import { hapticTap, hapticNavigate, hapticAgain } from '../lib/platform/haptics';
import { pickApkgFile, pickImageFile } from '../lib/platform/filePicker';
import { PixelCat } from '../components/PixelCat';
import { ThumbnailCropper } from '../components/ThumbnailCropper';
import { TabBar, TAB_BAR_TOTAL_HEIGHT } from '../components/TabBar';
import { useDeviceInfo } from '../hooks/useDeviceInfo';
import type { AppMode } from '../App';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface HomeProps {
  db: Database | null;
  dbLoading: boolean;
  dbError: string;
  /** Per-deck registry entries (new sync architecture). */
  deckEntries?: import('../lib/sync/types').DeckRegistryEntry[];
  /** Deck manager for per-deck operations (new sync architecture). */
  deckManager?: import('../hooks/useDeckManager').UseDeckManagerReturn;
  /** iCloud sync status indicator. */
  syncStatus?: import('../hooks/useSync').SyncStatus;
  /** Human-readable sync error message. */
  syncError?: string | null;
  /** Timestamp (ms) of last successful sync. */
  lastSyncedAt?: number | null;
  /** Whether iCloud is reachable on this device. */
  icloudAvailability: import('../hooks/useICloudAvailability').ICloudAvailability;
  /** Current app mode (learn vs review). */
  mode: AppMode;
  /** Called when user switches tabs. */
  onModeChange: (mode: AppMode) => void;
  onStudy: (deckId: string, deckName: string) => void;
  onReviewStudy: (deckId: string, deckName: string) => void;
  onBrowse: (deckId: string, deckName: string) => void;
  onStats: (deckId: string, deckName: string) => void;
  onSettings: (scrollTo?: string) => void;
  onTags: () => void;
  onDeckSettings?: (deckId: string, deckName: string) => void;
  /** File opened externally via iOS "Open in" / share sheet. */
  pendingFile?: File | null;
  /** Called after the pending file has been handed to the import pipeline. */
  onPendingFileConsumed?: () => void;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------


/** Inline SVG magnifying glass icon. */
function MagnifyingGlassIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <line x1="16.5" y1="16.5" x2="22" y2="22" />
    </svg>
  );
}

/** Inline SVG X icon. */
function XMarkIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

/** Inline SVG plain plus icon (no circle). */
function PlusIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="4" x2="12" y2="20" />
      <line x1="4" y1="12" x2="20" y2="12" />
    </svg>
  );
}


const IMPORT_LABELS: Record<string, string> = {
  parsing: 'Parsing .apkg file…',
  'storing-cards': 'Storing cards — this may take a moment for large decks…',
  'storing-media': 'Storing media files…',
};


/** Action menu for a deck row — "..." button that opens a dropdown. */
function DeckActionMenu({
  onBrowse,
  onStats,
  onExportFresh,
  onExportWithProgress,
  onSetThumbnail,
  onDelete,
  exporting,
}: {
  onBrowse: () => void;
  onStats: () => void;
  onExportFresh: () => void;
  onExportWithProgress: () => void;
  onSetThumbnail: () => void;
  onDelete: () => void;
  exporting: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [expandUp, setExpandUp] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const toggle = () => {
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setExpandUp(rect.top > window.innerHeight / 2);
    }
    hapticTap();
    setOpen(v => !v);
  };
  const close = () => setOpen(false);

  const items: { label: string; icon: React.ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean }[] = [
    { label: 'Cards', onClick: onBrowse, icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2" /><line x1="7" y1="10" x2="17" y2="10" /><line x1="7" y1="14" x2="13" y2="14" /></svg> },
    { label: 'Statistics', onClick: onStats, icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></svg> },
    { label: 'Set Thumbnail', onClick: onSetThumbnail, icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg> },
    { label: exporting ? 'Exporting…' : 'Share', onClick: onExportFresh, disabled: exporting, icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" /></svg> },
    { label: exporting ? 'Exporting…' : 'Export with progress', onClick: onExportWithProgress, disabled: exporting, icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg> },
    { label: 'Delete Deck', onClick: onDelete, danger: true, icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg> },
  ];

  // Reverse item order when expanding upward so the closest items appear first
  const ordered = expandUp ? [...items].reverse() : items;
  const animClass = expandUp ? 'fab-item-enter' : 'fab-item-enter-down';

  return (
    <div className="shrink-0">
      <button
        ref={triggerRef}
        onClick={toggle}
        className="w-10 h-10 flex items-center justify-center text-[#C4C4C4] hover:text-[#1c1c1e] dark:hover:text-[#E5E5E5] transition-colors shrink-0"
        aria-label="Deck actions"
      >
        {open ? (
          <svg
            width="16" height="16" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2.5"
            strokeLinecap="round" strokeLinejoin="round"
          >
            <polyline points={expandUp ? '5 15 12 8 19 15' : '5 9 12 16 19 9'} />
          </svg>
        ) : (
          <span className="text-sm font-bold tracking-wider">···</span>
        )}
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/40 backdrop-enter"
            onClick={close}
          />
          <div
            className="fixed z-50 flex flex-col items-end gap-2"
            style={{
              right: 'max(1rem, env(safe-area-inset-right))',
              ...(expandUp
                ? { bottom: `${window.innerHeight - (triggerRef.current?.getBoundingClientRect().top ?? 0) + 4}px` }
                : { top: `${(triggerRef.current?.getBoundingClientRect().bottom ?? 0) + 4}px` }),
            }}
          >
            {ordered.map((item, i) => (
              <button
                key={item.label}
                onClick={() => { close(); hapticNavigate(); item.onClick(); }}
                disabled={item.disabled}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-medium shadow-lg active:opacity-80 transition-opacity disabled:opacity-40 ${animClass} ${
                  item.danger
                    ? 'bg-red-500/90 text-white border border-red-400/30'
                    : 'text-[var(--kit-pill-text)] pill-border'
                }`}
                style={{ animationDelay: `${i * 0.03}s` }}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** A single deck row in the list with progress bar and MiniCat. */
function DeckRow({
  deck,
  counts,
  thumbnail,
  matchedTag,
  mode,
  onTap,
  onBrowse,
  onStats,
  onExportFresh,
  onExportWithProgress,
  onSetThumbnail,
  onDelete,
  exporting,
}: {
  deck: Deck;
  counts: DeckCardCounts | undefined;
  thumbnail: string | undefined;
  matchedTag?: string;
  mode: AppMode;
  onTap: () => void;
  onBrowse: () => void;
  onStats: () => void;
  onExportFresh: () => void;
  onExportWithProgress: () => void;
  onSetThumbnail: () => void;
  onDelete: () => void;
  exporting: boolean;
}) {
  const newCount = counts?.newCount ?? 0;
  const learningCount = counts?.learningCount ?? 0;
  const reviewCount = counts?.reviewCount ?? 0;
  const totalCount = counts?.totalCount ?? 0;
  const dueCount = newCount + learningCount + reviewCount;
  const progress = totalCount > 0 ? (totalCount - dueCount) / totalCount : 0;

  return (
    <div className="border-b border-[#E5E5E5] dark:border-[#262626]">
      <div className="flex items-center">
        <button
          onClick={onTap}
          className="flex-1 text-left px-4 py-3 flex items-center active:bg-[#F0F0F0] dark:active:bg-[#1A1A1A] transition-colors min-w-0 gap-3"
        >
          {/* Thumbnail */}
          {thumbnail && (
            <img
              src={thumbnail}
              alt=""
              className="w-10 h-10 rounded-lg object-cover shrink-0"
            />
          )}
          <div className="flex flex-col gap-0.5 min-w-0 flex-1">
            <span
              className="text-sm font-semibold text-[#1c1c1e] dark:text-[#E5E5E5] truncate"
              style={{ fontFamily: "-apple-system, 'Apple Color Emoji', 'Segoe UI Emoji', system-ui, sans-serif" }}
            >
              {deck.name}
            </span>
            <span className="text-xs text-[#C4C4C4]">
              {matchedTag ? `Contains: ${matchedTag}` : `${totalCount} ${totalCount === 1 ? 'card' : 'cards'}`}
            </span>
          </div>
          {mode === 'learn' && totalCount > 0 && (
            <div className="flex gap-2 ml-4 shrink-0 text-sm font-semibold tabular-nums">
              <span className="text-blue-500">{newCount}</span>
              <span className="text-red-500">{learningCount}</span>
              <span className="text-green-500">{reviewCount}</span>
            </div>
          )}
          {mode === 'review' && totalCount > 0 && (
            <span className="ml-4 shrink-0 text-sm font-bold text-[#1c1c1e] dark:text-[#E5E5E5] tabular-nums">
              {totalCount}
            </span>
          )}
        </button>
        <DeckActionMenu
          onBrowse={onBrowse}
          onStats={onStats}
          onExportFresh={onExportFresh}
          onExportWithProgress={onExportWithProgress}
          onSetThumbnail={onSetThumbnail}
          onDelete={onDelete}
          exporting={exporting}
        />
      </div>

      {/* Progress bar — visible in Learn mode, invisible spacer in Review mode */}
      {totalCount > 0 && (
        <div className="px-4 pb-2 pt-0.5">
          <div className={`deck-progress-track w-full ${mode === 'learn' ? 'bg-[#E5E5E5] dark:bg-[#262626]' : 'bg-transparent'}`}>
            {mode === 'learn' && (
              <div
                className="deck-progress-fill bg-[#1c1c1e] dark:bg-[#E5E5E5]"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Plus button dropdown — "Create Deck" / "Import Deck". */
function PlusMenu({
  onCreateDeck,
  onImportDeck,
  disabled,
}: {
  onCreateDeck: () => void;
  onImportDeck: () => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = () => setOpen(false);

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        onClick={() => { if (!disabled) { hapticTap(); setOpen(v => !v); } }}
        disabled={disabled}
        className="p-2 text-[#C4C4C4] hover:text-[#1c1c1e] dark:hover:text-[#E5E5E5] transition-colors disabled:opacity-40"
        aria-label="Add deck"
      >
        <PlusIcon />
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/40 backdrop-enter"
            onClick={close}
          />
          <div
            className="fixed z-50 flex flex-col items-end gap-2"
            style={{
              right: 'max(1rem, env(safe-area-inset-right))',
              top: `${(triggerRef.current?.getBoundingClientRect().bottom ?? 0) + 4}px`,
            }}
          >
            <button
              onClick={() => { close(); hapticNavigate(); onCreateDeck(); }}
              className="flex items-center gap-2 px-4 py-2.5 rounded-full text-[var(--kit-pill-text)] text-sm font-medium shadow-lg active:opacity-80 transition-opacity pill-border fab-item-enter-down"
              style={{ animationDelay: '0s' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Create Deck
            </button>
            <button
              onClick={() => { close(); hapticNavigate(); onImportDeck(); }}
              className="flex items-center gap-2 px-4 py-2.5 rounded-full text-[var(--kit-pill-text)] text-sm font-medium shadow-lg active:opacity-80 transition-opacity pill-border fab-item-enter-down"
              style={{ animationDelay: '0.03s' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              Import Deck
            </button>
          </div>
        </>
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

/** Format a timestamp as a human-readable relative time string. */
function formatTimeAgo(ms: number): string {
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** Persistent sync status chip in the Home header. Always-visible, tap to open Settings. */
function SyncChip({
  icloudAvailability,
  syncStatus,
  syncError,
  lastSyncedAt,
  deviceName,
  onOpenSync,
}: {
  icloudAvailability: import('../hooks/useICloudAvailability').ICloudAvailability;
  syncStatus: import('../hooks/useSync').SyncStatus | undefined;
  syncError: string | null;
  lastSyncedAt: number | null;
  deviceName: string;
  onOpenSync: () => void;
}) {
  // Derive a single visual state from availability + sync status.
  let dotClass = 'bg-[#C4C4C4]';
  let label = `Saved on ${deviceName.toLowerCase()}`;

  if (icloudAvailability === 'checking') {
    dotClass = 'bg-[#C4C4C4]';
    label = 'Checking iCloud…';
  } else if (icloudAvailability === 'unavailable') {
    dotClass = 'bg-[#C4C4C4]';
    label = `Saved on ${deviceName.toLowerCase()}`;
  } else if (syncStatus === 'syncing') {
    dotClass = 'bg-blue-400 animate-pulse';
    label = 'Syncing…';
  } else if (syncStatus === 'error') {
    dotClass = 'bg-amber-400';
    label = syncError === 'iCloud unavailable' ? `Saved on ${deviceName.toLowerCase()}` : 'Sync issue';
  } else if (lastSyncedAt) {
    dotClass = 'bg-green-400';
    label = `Synced ${formatTimeAgo(lastSyncedAt)}`;
  } else {
    // Available but nothing synced yet this session.
    dotClass = 'bg-green-400';
    label = 'iCloud ready';
  }

  return (
    <button
      onClick={onOpenSync}
      className="flex items-center gap-1.5 px-2 py-1 rounded-full active:opacity-70 transition-opacity"
      aria-label={`Sync status: ${label}. Tap for details.`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dotClass}`} />
      <span className="text-[11px] text-[#C4C4C4] whitespace-nowrap">{label}</span>
    </button>
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
export default function Home({ db, dbLoading, dbError, deckEntries, deckManager, syncStatus, syncError, lastSyncedAt, icloudAvailability, mode, onModeChange, onStudy, onReviewStudy, onBrowse, onStats, onSettings, onTags, pendingFile, onPendingFileConsumed }: HomeProps) {
  /** True when using the new per-deck architecture. */
  const useNewArch = !!(deckEntries && deckManager);

  const [decks, setDecks] = useState<Deck[] | null>(null);
  const [counts, setCounts] = useState<Record<string, DeckCardCounts>>({});
  const [catBouncing, setCatBouncing] = useState(false);

  const { deviceName } = useDeviceInfo();

  // Swipe-to-switch-tabs state
  const swipeRef = useRef({ startX: 0, startY: 0, decided: false, isHorizontal: false });
  const [swipeX, setSwipeX] = useState(0);
  const [swipeTransition, setSwipeTransition] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const swipeTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Non-passive touchmove so we can preventDefault during horizontal swipes
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const ref = swipeRef;
    const onMove = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (!touch) return;
      const dx = touch.clientX - ref.current.startX;
      const dy = touch.clientY - ref.current.startY;

      if (!ref.current.decided && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
        ref.current.decided = true;
        ref.current.isHorizontal = Math.abs(dx) > Math.abs(dy) * 1.2;
      }
      if (!ref.current.decided || !ref.current.isHorizontal) return;

      e.preventDefault();
      let clamped = dx;
      if (modeRef.current === 'learn' && dx > 0) clamped = dx * 0.15;
      if (modeRef.current === 'review' && dx < 0) clamped = dx * 0.15;
      setSwipeX(clamped);
    };
    el.addEventListener('touchmove', onMove, { passive: false });
    return () => el.removeEventListener('touchmove', onMove);
  }, []);

  const handleSwipeStart = useCallback((e: React.TouchEvent) => {
    if (swipeTimeoutRef.current) clearTimeout(swipeTimeoutRef.current);
    setSwipeTransition(false);
    const touch = e.touches[0]!;
    swipeRef.current = { startX: touch.clientX, startY: touch.clientY, decided: false, isHorizontal: false };
  }, []);

  const handleSwipeEnd = useCallback(() => {
    if (!swipeRef.current.isHorizontal) { setSwipeX(0); return; }
    const threshold = 60;
    const x = swipeX;
    if (x < -threshold && modeRef.current === 'learn') {
      setSwipeTransition(true);
      setSwipeX(-window.innerWidth);
      hapticTap();
      swipeTimeoutRef.current = setTimeout(() => {
        onModeChange('review');
        setSwipeTransition(false);
        setSwipeX(0);
      }, 220);
    } else if (x > threshold && modeRef.current === 'review') {
      setSwipeTransition(true);
      setSwipeX(window.innerWidth);
      hapticTap();
      swipeTimeoutRef.current = setTimeout(() => {
        onModeChange('learn');
        setSwipeTransition(false);
        setSwipeX(0);
      }, 220);
    } else {
      setSwipeTransition(true);
      setSwipeX(0);
      swipeTimeoutRef.current = setTimeout(() => setSwipeTransition(false), 200);
    }
    swipeRef.current.isHorizontal = false;
    swipeRef.current.decided = false;
  }, [swipeX, onModeChange]);

  // Search / sort state
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOrder, setSortOrder] = useState<'alpha' | 'alpha-desc' | 'due' | 'recent'>('alpha');
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  // Default sort order per mode
  useEffect(() => {
    setSortOrder(mode === 'review' ? 'recent' : 'alpha');
  }, [mode]);

  // ── Synthesize decks + counts from registry entries (new arch) ──────
  useEffect(() => {
    if (!useNewArch) return;
    const synthDecks: Deck[] = deckEntries.map(e => ({
      id: e.deckId,
      name: e.name || 'Untitled',
      description: '',
      createdAt: 0,
      updatedAt: e.lastAccessedAt,
    }));
    setDecks(synthDecks);

    const synthCounts: Record<string, DeckCardCounts> = {};
    for (const e of deckEntries) {
      synthCounts[e.deckId] = {
        deckId: e.deckId,
        newCount: e.newCount ?? 0,
        learningCount: e.learningCount ?? 0,
        reviewCount: e.reviewCount ?? 0,
        totalCount: e.cardCount,
      };
    }
    setCounts(synthCounts);
  }, [useNewArch, deckEntries]);

  // Thumbnail state
  const deckIds = useMemo(() => (decks ?? []).map(d => d.id), [decks]);
  const { thumbnails, setThumbnail } = useDeckThumbnails(deckIds);

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

    if (sortOrder === 'alpha') {
      combined.sort((a, b) => a.deck.name.localeCompare(b.deck.name));
    } else if (sortOrder === 'alpha-desc') {
      combined.sort((a, b) => b.deck.name.localeCompare(a.deck.name));
    } else if (sortOrder === 'recent') {
      combined.sort((a, b) => (b.deck.updatedAt ?? 0) - (a.deck.updatedAt ?? 0));
    } else {
      combined.sort((a, b) => {
        const ca = counts[a.deck.id];
        const cb = counts[b.deck.id];
        const dueA = (ca?.newCount ?? 0) + (ca?.learningCount ?? 0) + (ca?.reviewCount ?? 0);
        const dueB = (cb?.newCount ?? 0) + (cb?.learningCount ?? 0) + (cb?.reviewCount ?? 0);
        return dueB - dueA;
      });
    }

    return combined;
  }, [db, useNewArch, decks, searchQuery, sortOrder, counts]);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [cropDeckId, setCropDeckId] = useState<string | null>(null);

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

  const { phase: importPhase, errorMessage: importError, importInfo, conflictInfo, importFile, resolveConflict, reset: resetImport } =
    useDeckImport(db, onImportComplete, deckManager);

  // ── Export hook ──────────────────────────────────────────────────────
  // In the per-deck arch, pass the deckManager so the hook can open each
  // deck's own db on demand — there's no longer a monolithic db to share.
  const { phase: exportPhase, errorMessage: exportError, exportDeckFresh, exportDeckWithProgress, reset: resetExport } =
    useExport(useNewArch ? deckManager : db);

  const isExporting = exportPhase === 'exporting';

  // ── Import toast ─────────────────────────────────────────────────────
  const [importToast, setImportToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const importToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (importPhase === 'done') {
      if (importToastTimerRef.current) clearTimeout(importToastTimerRef.current);
      setImportToast({ type: 'success', message: `Deck imported successfully!${importInfo ? ` (${importInfo})` : ''}` });
      importToastTimerRef.current = setTimeout(() => {
        setImportToast(null);
        resetImport();
      }, 3000);
    } else if (importPhase === 'error' && importError) {
      if (importToastTimerRef.current) clearTimeout(importToastTimerRef.current);
      setImportToast({ type: 'error', message: importError });
    }
  }, [importPhase, importInfo, importError, resetImport]);

  useEffect(() => {
    return () => { if (importToastTimerRef.current) clearTimeout(importToastTimerRef.current); };
  }, []);

  // ── Rename handler ──────────────────────────────────────────────────
  const handleRename = useCallback(
    async (deckId: string, newName: string) => {
      if (useNewArch) {
        const deckDb = deckManager.getCachedDeckDb(deckId) ?? await deckManager.openDeckDb(deckId);
        if (!deckDb) return;
        const now = Math.floor(Date.now() / 1000);
        const result = renameDeck(deckDb, deckId, newName, now);
        if (result.success) {
          await deckManager.writeEdit(deckId, [{ type: 'deck_rename', name: newName }]);
          deckManager.refreshCounts(deckId);
          await deckManager.saveRegistry();
          await deckManager.refreshDecks();
        }
        return;
      }
      if (!db) return;
      const now = Math.floor(Date.now() / 1000);
      const result = renameDeck(db, deckId, newName, now);
      if (result.success) {
        persistAndBackup();
        refreshDecks();
      }
    },
    [useNewArch, deckManager, db, refreshDecks],
  );

  // ── Create deck handler ────────────────────────────────────────────
  const handleCreateDeck = useCallback(async () => {
    const now = Math.floor(Date.now() / 1000);
    const deck = { id: uuidv4(), name: 'New Deck', description: '', createdAt: now, updatedAt: now };

    if (useNewArch) {
      const snapshot: import('../lib/sync/types').DeckSnapshot = {
        v: 1,
        deckId: deck.id,
        compactedThrough: '',
        mergedEditFiles: [],
        deck,
        settings: {
          deckId: deck.id,
          newCardsPerDay: 20,
          maxReviewsPerDay: 200,
          againSteps: [1, 10],
          graduatingInterval: 1,
          easyInterval: 4,
          maxInterval: 36500,
          leechThreshold: 8,
          desiredRetention: 0.9,
        },
        noteTypes: [],
        notes: [],
        cards: [],
        cardStates: [],
        reviewLogs: [],
        tags: [],
        deckTags: [],
        deletedCardIds: [],
      };
      const newDb = await deckManager.createFromSnapshot(snapshot);
      if (newDb) {
        await deckManager.saveRegistry();
        await deckManager.refreshDecks();
        hapticTap();
        onBrowse(deck.id, deck.name);
      }
      return;
    }
    if (!db) return;
    const result = insertDeck(db, deck);
    if (result.success) {
      persistAndBackup();
      refreshDecks();
      hapticTap();
      onBrowse(deck.id, deck.name);
    }
  }, [useNewArch, deckManager, db, refreshDecks, onBrowse]);

  // ── Rename dialog state ──────────────────────────────────────────────
  const [renamingDeck, setRenamingDeck] = useState<{ id: string; name: string } | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renamingDeck) renameInputRef.current?.focus();
  }, [renamingDeck]);

  const handleRenameConfirm = useCallback(() => {
    if (!renamingDeck) return;
    const trimmed = renameDraft.trim();
    if (trimmed && trimmed !== renamingDeck.name) {
      handleRename(renamingDeck.id, trimmed);
    }
    setRenamingDeck(null);
    setRenameDraft('');
  }, [renamingDeck, renameDraft, handleRename]);

  // ── Delete handler ──────────────────────────────────────────────────
  const [deletingDeck, setDeletingDeck] = useState<{ id: string; name: string } | null>(null);

  const handleDeleteRequest = useCallback((deckId: string, deckName: string) => {
    hapticAgain();
    setDeletingDeck({ id: deckId, name: deckName });
  }, []);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deletingDeck) return;
    const deckId = deletingDeck.id;

    if (useNewArch) {
      await deckManager.removeDeck(deckId);
      await deleteMediaForDeck(deckId);
      await deckManager.refreshDecks();
      setDeletingDeck(null);
      return;
    }
    if (!db) return;
    const result = deleteDeck(db, deckId);
    if (result.success) {
      await deleteMediaForDeck(deckId);
      persistAndBackup();
      refreshDecks();
    }
    setDeletingDeck(null);
  }, [useNewArch, deckManager, db, deletingDeck, refreshDecks]);

  // ── Import using native file picker ────────────────────────────────
  const openFilePicker = useCallback(async () => {
    if (importPhase !== 'idle' && importPhase !== 'done' && importPhase !== 'error') return;
    if (importPhase === 'done' || importPhase === 'error') resetImport();
    hapticTap();
    const file = await pickApkgFile();
    if (file) importFile(file);
  }, [importPhase, resetImport, importFile]);

  // ── Auto-import file opened externally (iOS "Open in") ──────────────
  useEffect(() => {
    if (!pendingFile) return;
    if (importPhase !== 'idle' && importPhase !== 'done' && importPhase !== 'error') return;
    if (importPhase === 'done' || importPhase === 'error') resetImport();
    importFile(pendingFile);
    onPendingFileConsumed?.();
  }, [pendingFile, importPhase, resetImport, importFile, onPendingFileConsumed]);

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

  // Full-screen loading splash — shown until db/registry is ready AND decks have loaded.
  // Completely separate from the normal layout so no header/buttons flash through.
  if ((dbLoading || decks === null) && !dbError) {
    return (
      <div className="min-h-[100dvh] bg-[var(--kit-bg)] flex flex-col items-center justify-center gap-3">
        <PixelCat size={28} />
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
    <div className="min-h-[100dvh] bg-[var(--kit-bg)] text-[#1c1c1e] dark:text-[#E5E5E5] flex flex-col page-enter">
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
          <span className="text-xs font-semibold tracking-widest text-[#1c1c1e] dark:text-[#E5E5E5] uppercase">Kit</span>
          <SyncChip
            icloudAvailability={icloudAvailability}
            syncStatus={syncStatus}
            syncError={syncError ?? null}
            lastSyncedAt={lastSyncedAt ?? null}
            deviceName={deviceName}
            onOpenSync={() => { hapticTap(); onSettings('icloud-sync'); }}
          />
        </div>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => {
              hapticTap();
              setSearchOpen((v) => {
                if (v) setSearchQuery('');
                return !v;
              });
            }}
            className="p-2 text-[#C4C4C4] hover:text-[#1c1c1e] dark:hover:text-[#E5E5E5] transition-colors"
            aria-label={searchOpen ? 'Close search' : 'Search decks'}
          >
            {searchOpen ? <XMarkIcon /> : <MagnifyingGlassIcon />}
          </button>
          <PlusMenu
            onCreateDeck={() => { hapticTap(); handleCreateDeck(); }}
            onImportDeck={openFilePicker}
            disabled={dbLoading || !!dbError}
          />
        </div>
      </header>

      {/* Search / sort bar — expands below header */}
      {searchOpen && (
        <div
          className="flex items-center gap-2 px-4 py-2 search-expand"
          style={{
            paddingLeft: 'max(1rem, env(safe-area-inset-left))',
            paddingRight: 'max(1rem, env(safe-area-inset-right))',
          }}
        >
          <input
            ref={searchInputRef}
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search decks…"
            className="flex-1 px-4 py-2 text-sm bg-[var(--kit-surface)] rounded-full text-[#1c1c1e] dark:text-[#E5E5E5] placeholder-[#C4C4C4] outline-none"
          />
          <button
            onClick={() =>
              setSortOrder((v) =>
                v === 'alpha' ? 'alpha-desc' : v === 'alpha-desc' ? 'due' : 'alpha',
              )
            }
            className="shrink-0 px-3 py-2 text-xs font-medium text-[#C4C4C4] hover:text-[#1c1c1e] dark:hover:text-[#E5E5E5] bg-[var(--kit-surface)] rounded-full transition-colors"
            title="Change sort order"
          >
            {sortOrder === 'alpha' ? 'A→Z' : sortOrder === 'alpha-desc' ? 'Z→A' : '# Due'}
          </button>
        </div>
      )}

      {/* Main content area — swipeable to switch Learn / Review */}
      <div
        ref={contentRef}
        onTouchStart={handleSwipeStart}
        onTouchEnd={handleSwipeEnd}
        className="flex flex-col flex-1 min-h-0 overflow-auto"
        style={{
          paddingBottom: TAB_BAR_TOTAL_HEIGHT,
          transform: swipeX ? `translateX(${swipeX}px)` : undefined,
          transition: swipeTransition ? 'transform 0.22s ease-out' : undefined,
          willChange: swipeX ? 'transform' : undefined,
        }}
      >
        {dbError ? (
          <div className="px-4 py-4">
            <p className="text-xs text-red-500">{dbError}</p>
          </div>
        ) : (
          <>
            {decks!.length === 0 && importPhase === 'idle' && !searchQuery && (
              <div className="px-4 py-12 text-center flex flex-col items-center gap-4">
                <PixelCat size={80} className="opacity-30" />
                <div>
                  <p className="text-sm text-[#C4C4C4]">No decks yet</p>
                  <p className="text-xs text-[#C4C4C4] mt-1">
                    Tap + to import an Anki .apkg file or create a deck
                  </p>
                </div>
              </div>
            )}
            {filteredDecks.length === 0 && searchQuery.trim() && (
              <div className="px-4 py-12 text-center">
                <p className="text-sm text-[#C4C4C4]">No decks match "{searchQuery}"</p>
              </div>
            )}
            {filteredDecks.map(({ deck, matchedTag }) => (
              <DeckRow
                key={deck.id}
                deck={deck}
                counts={counts[deck.id]}
                thumbnail={thumbnails[deck.id]}
                mode={mode}
                {...(matchedTag !== undefined && { matchedTag })}
                onTap={() => { hapticNavigate(); mode === 'review' ? onReviewStudy(deck.id, deck.name) : onStudy(deck.id, deck.name); }}
                onBrowse={() => { hapticNavigate(); onBrowse(deck.id, deck.name); }}
                onStats={() => { hapticNavigate(); onStats(deck.id, deck.name); }}
                onExportFresh={() => { hapticTap(); exportDeckFresh(deck.id, deck.name); }}
                onExportWithProgress={() => { hapticTap(); exportDeckWithProgress(deck.id, deck.name); }}
                onSetThumbnail={() => handleSetThumbnail(deck.id)}
                onDelete={() => handleDeleteRequest(deck.id, deck.name)}
                exporting={isExporting}
              />
            ))}
          </>
        )}
      </div>

      {/* Import progress */}
      {isImporting && <ImportProgress phase={importPhase} />}

      {/* Import toast — fixed at top of screen */}
      {importToast && (
        <div
          className="fixed left-4 right-4 z-[100] toast-enter"
          style={{ top: 'calc(env(safe-area-inset-top) + 0.75rem)' }}
          onClick={() => {
            if (importToastTimerRef.current) clearTimeout(importToastTimerRef.current);
            setImportToast(null);
            if (importPhase === 'error') resetImport();
          }}
        >
          <div className={`rounded-xl px-4 py-3 shadow-lg text-sm font-medium text-white ${
            importToast.type === 'success' ? 'bg-green-500' : 'bg-red-500'
          }`}>
            {importToast.message}
          </div>
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

      {/* Duplicate import dialog */}
      {importPhase === 'duplicate-found' && conflictInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-8">
          <div className="bg-[#FDFBF7] dark:bg-[#1A1A1A] rounded-2xl w-full max-w-sm overflow-hidden">
            <div className="px-6 pt-5 pb-4 text-center">
              <p className="text-base font-semibold text-[#1c1c1e] dark:text-[#E5E5E5]">
                Deck already exists
              </p>
              <p className="text-sm text-[#C4C4C4] mt-2">
                A deck named <span className="font-medium text-[#1c1c1e] dark:text-[#E5E5E5]">"{conflictInfo.deckName}"</span> already exists. What would you like to do?
              </p>
            </div>
            <div className="flex flex-col border-t border-[#E5E5E5] dark:border-[#333]">
              <button
                onClick={() => { hapticTap(); resolveConflict('replace'); }}
                className="py-3.5 text-sm font-medium text-red-500 active:bg-[#F0F0F0] dark:active:bg-[#262626] border-b border-[#E5E5E5] dark:border-[#333]"
              >
                Replace existing deck
              </button>
              <button
                onClick={() => { hapticTap(); resolveConflict('new'); }}
                className="py-3.5 text-sm font-medium text-[#1c1c1e] dark:text-[#E5E5E5] active:bg-[#F0F0F0] dark:active:bg-[#262626] border-b border-[#E5E5E5] dark:border-[#333]"
              >
                Import as new deck
              </button>
              <button
                onClick={() => { hapticTap(); resetImport(); }}
                className="py-3.5 text-sm text-[#C4C4C4] active:bg-[#F0F0F0] dark:active:bg-[#262626]"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

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

      {/* Rename deck dialog */}
      {renamingDeck && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-8">
          <div className="bg-[#FDFBF7] dark:bg-[#1A1A1A] rounded-2xl w-full max-w-sm overflow-hidden">
            <div className="px-6 pt-5 pb-4">
              <p className="text-base font-semibold text-[#1c1c1e] dark:text-[#E5E5E5] text-center mb-4">
                Rename Deck
              </p>
              <input
                ref={renameInputRef}
                type="text"
                value={renameDraft}
                onChange={(e) => setRenameDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleRenameConfirm(); }}
                className="w-full px-3 py-2.5 text-sm bg-[#F0F0F0] dark:bg-[#262626] border border-[#D4D4D4] dark:border-[#404040] rounded-lg text-[#1c1c1e] dark:text-[#E5E5E5] outline-none"
              />
            </div>
            <div className="flex border-t border-[#E5E5E5] dark:border-[#333]">
              <button
                onClick={() => { setRenamingDeck(null); setRenameDraft(''); }}
                className="flex-1 py-3.5 text-sm font-medium text-[#1c1c1e] dark:text-[#E5E5E5] active:bg-[#F0F0F0] dark:active:bg-[#262626] border-r border-[#E5E5E5] dark:border-[#333]"
              >
                Cancel
              </button>
              <button
                onClick={handleRenameConfirm}
                disabled={!renameDraft.trim()}
                className="flex-1 py-3.5 text-sm font-semibold text-[#1c1c1e] dark:text-[#E5E5E5] active:bg-[#F0F0F0] dark:active:bg-[#262626] disabled:opacity-40"
              >
                Save
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

      {/* Bottom pill bar (mode toggle + settings FAB) */}
      {!dbLoading && !dbError && (
        <TabBar mode={mode} onChange={onModeChange} onTags={onTags} onSettings={onSettings} />
      )}
    </div>
  );
}
