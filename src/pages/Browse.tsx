/**
 * Browse page — visual card browser with selection, tag filter, sort, and review pass.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Database } from 'sql.js';
import type { Card } from '../types';
import { getCardsByDeck, deleteCards, renameDeck, getTagsForDeck, updateCardTags, type TagCount } from '../lib/db/queries';
import { sortTagsByColor } from '../lib/tagSort';
import { pillTextColor, getColorSortKey } from '../lib/tagColors';
import { v4 as uuidv4 } from 'uuid';
import { useDeckMedia } from '../hooks/useDeckMedia';
import { CardEditor } from '../components/CardEditor';
import { hapticAgain, hapticTap } from '../lib/platform/haptics';
import { renderImageOcclusion } from '../lib/imageOcclusion';
import { persistAndBackup } from '../hooks/useDatabase';
import type { EditOp } from '../lib/sync/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 50;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface BrowseProps {
  db: Database | null;
  deckId: string;
  deckName: string;
  onBack: () => void;
  /** Callback to emit sync edit operations (new per-deck architecture). */
  onSyncEdit?: ((ops: EditOp[]) => void) | undefined;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function CardFacePreview({ html, tagColors }: { html: string; tagColors?: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.innerHTML = `<div class="card">${html}</div>`;
  }, [html]);
  return (
    <div className="flex-1 min-w-0 flex flex-col">
      <div
        className="browse-card-preview card-content bg-[#FFFFFF] dark:bg-[var(--kit-surface)] border border-[#E5E5E5] dark:border-[#262626] rounded-md relative"
        style={{ height: '12rem', overflow: 'hidden' }}
      >
        {/* Tag dots — up to 9, rainbow ordered, top-left */}
        {tagColors && tagColors.length > 0 && (
          <div className="absolute top-1.5 left-1.5 z-10 flex gap-[3px] flex-wrap" style={{ maxWidth: '4.5rem' }}>
            {tagColors.slice(0, 9).map((color, i) => (
              <span
                key={i}
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
        )}
        <div ref={ref} className="px-2 py-1.5 text-xs leading-relaxed" />
        <div className="browse-card-fade" />
      </div>
    </div>
  );
}

/** Threshold in px for swipe gestures. */
const SWIPE_THRESHOLD = 60;
/** Max px of horizontal swipe travel. */
const SWIPE_MAX_DX = 100;
/** Max vertical movement allowed during a swipe. */
const SWIPE_MAX_Y = 30;

function CardPreviewRow({
  card,
  rewriteHtml,
  selected,
  selectionMode,
  tagColorMap,
  swipeEnabled,
  onTap,
  onToggleSelect,
  onLongPress,
  onSwipeRight,
  onSwipeLeft,
}: {
  card: Card;
  rewriteHtml: (html: string) => string;
  selected: boolean;
  selectionMode: boolean;
  tagColorMap: Map<string, string>;
  /** Whether any tag pills are selected (enables swiping). */
  swipeEnabled: boolean;
  onTap: () => void;
  onToggleSelect: () => void;
  onLongPress: () => void;
  onSwipeRight: () => void;
  onSwipeLeft: () => void;
}) {
  const front = renderImageOcclusion(rewriteHtml(card.front), 'front');
  const back = renderImageOcclusion(rewriteHtml(card.back), 'back');

  // Tag dot colors for this card, sorted in rainbow order
  const dotColors = useMemo(() => {
    if (card.tags.length === 0) return [];
    return card.tags
      .map(t => ({ tag: t, color: tagColorMap.get(t) || '#9E9E9E' }))
      .sort((a, b) => getColorSortKey(a.color) - getColorSortKey(b.color))
      .map(tc => tc.color);
  }, [card.tags, tagColorMap]);

  // Swipe + long-press gesture state (swipe disabled when no pills selected)
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const swipeOffsetRef = useRef(0);
  const rowRef = useRef<HTMLDivElement>(null);
  const circleRef = useRef<HTMLDivElement>(null);
  const tagIconRef = useRef<SVGSVGElement>(null);
  const xIconRef = useRef<SVGSVGElement>(null);
  const iconWrapRef = useRef<HTMLDivElement>(null);
  const didSwipeRef = useRef(false);
  const hapticFiredRef = useRef(false);

  const clearLongPress = () => {
    if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; }
  };

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    if (!touch) return;
    didSwipeRef.current = false;
    hapticFiredRef.current = false;
    touchStartRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };
    swipeOffsetRef.current = 0;
    // Reset indicator
    if (circleRef.current) { circleRef.current.style.transform = 'scale(0)'; circleRef.current.style.opacity = '0'; circleRef.current.style.backgroundColor = ''; }
    if (iconWrapRef.current) { iconWrapRef.current.style.transform = 'scale(0)'; iconWrapRef.current.style.opacity = '0'; }
    longPressTimerRef.current = setTimeout(() => {
      longPressTimerRef.current = null;
      touchStartRef.current = null;
      onLongPress();
    }, 500);
  }, [onLongPress]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!touchStartRef.current) return;
    const touch = e.touches[0];
    if (!touch) return;
    const dx = touch.clientX - touchStartRef.current.x;
    const dy = touch.clientY - touchStartRef.current.y;
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) clearLongPress();
    if (Math.abs(dy) > SWIPE_MAX_Y) return;
    if (!swipeEnabled) return;
    swipeOffsetRef.current = dx;

    const absDx = Math.abs(dx);
    const progress = Math.min(absDx / SWIPE_THRESHOLD, 1);
    const isRight = dx > 0;

    const isDark = document.documentElement.classList.contains('dark');
    const atThreshold = progress >= 1;
    const circleBg = !isRight && atThreshold
      ? '#EF4444'
      : atThreshold
        ? (isDark ? '#FFFFFF' : '#000000')
        : (isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.25)');
    const iconColor = !isRight && atThreshold
      ? '#FFFFFF'
      : isDark ? '#000000' : '#FFFFFF';

    // Imperative DOM updates for 60fps gesture tracking (React state would cause jank)
    if (circleRef.current && absDx > 10) {
      // Exponential curve: stays small early, grows fast near threshold
      const circleScale = Math.pow(progress, 2.5) * 1.2;
      circleRef.current.style.transform = `scale(${circleScale})`;
      circleRef.current.style.opacity = String(atThreshold ? 0.85 : Math.min(Math.pow(progress, 2) * 0.6, 0.5));
      circleRef.current.style.backgroundColor = circleBg;
      circleRef.current.style.transition = 'none';
      circleRef.current.style.left = isRight ? '2rem' : '';
      circleRef.current.style.right = isRight ? '' : '2rem';
    }

    if (iconWrapRef.current && absDx > 10) {
      const iconScale = Math.min(Math.pow(progress, 2) * 1.1, 1);
      iconWrapRef.current.style.transform = `scale(${iconScale})`;
      iconWrapRef.current.style.opacity = String(Math.min(Math.pow(progress, 1.5) * 1.5, 1));
      iconWrapRef.current.style.transition = 'none';
      iconWrapRef.current.style.left = isRight ? '2rem' : '';
      iconWrapRef.current.style.right = isRight ? '' : '2rem';
      if (tagIconRef.current) tagIconRef.current.style.display = isRight ? '' : 'none';
      if (xIconRef.current) xIconRef.current.style.display = isRight ? 'none' : '';
      iconWrapRef.current.style.color = iconColor;
    }

    if (absDx >= SWIPE_THRESHOLD && !hapticFiredRef.current) {
      hapticFiredRef.current = true;
      hapticTap();
    }

    if (rowRef.current && absDx > 10) {
      const clamped = Math.max(-SWIPE_MAX_DX, Math.min(SWIPE_MAX_DX, dx));
      rowRef.current.style.transform = `translateX(${clamped}px)`;
      rowRef.current.style.transition = 'none';
    }
  }, [swipeEnabled]);

  const handleTouchEnd = useCallback(() => {
    clearLongPress();
    const dx = swipeOffsetRef.current;
    // Snap back row
    if (rowRef.current) {
      rowRef.current.style.transform = '';
      rowRef.current.style.transition = 'transform 0.2s ease';
    }
    // Fade out indicator
    if (circleRef.current) {
      circleRef.current.style.transform = 'scale(0)';
      circleRef.current.style.opacity = '0';
      circleRef.current.style.transition = 'all 0.2s ease';
    }
    if (iconWrapRef.current) {
      iconWrapRef.current.style.transform = 'scale(0)';
      iconWrapRef.current.style.opacity = '0';
      iconWrapRef.current.style.transition = 'all 0.2s ease';
    }
    if (dx > SWIPE_THRESHOLD) {
      didSwipeRef.current = true;
      onSwipeRight();
    } else if (dx < -SWIPE_THRESHOLD) {
      didSwipeRef.current = true;
      onSwipeLeft();
    }
    touchStartRef.current = null;
    swipeOffsetRef.current = 0;
  }, [onSwipeRight, onSwipeLeft]);

  const handleClick = useCallback(() => {
    if (didSwipeRef.current) return;
    if (selectionMode) onToggleSelect(); else onTap();
  }, [selectionMode, onToggleSelect, onTap]);

  return (
    <div className="relative">
      {/* Swipe indicator: expanding circle — centered on row */}
      <div
        ref={circleRef}
        className="absolute w-12 h-12 rounded-full pointer-events-none"
        style={{ transform: 'scale(0)', opacity: 0, top: 'calc(50% - 1.5rem)' }}
      />
      <div
        ref={iconWrapRef}
        className="absolute w-12 h-12 flex items-center justify-center pointer-events-none"
        style={{ transform: 'scale(0)', opacity: 0, zIndex: 1, top: 'calc(50% - 1.5rem)' }}
      >
        <svg ref={tagIconRef} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
          <line x1="7" y1="7" x2="7.01" y2="7" />
        </svg>
        <svg ref={xIconRef} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'none', position: 'absolute' }}>
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </div>

      <div
        ref={rowRef}
        className={`relative flex items-center border-b border-[#E5E5E5] dark:border-[#262626] bg-[var(--kit-bg)] transition-colors ${
          selected ? 'bg-blue-50 dark:bg-blue-950/30' : ''
        }`}
        style={{ zIndex: 2 }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {selectionMode && (
          <button
            onClick={onToggleSelect}
            className="pl-4 pr-2 py-3 shrink-0 flex items-center"
            aria-label={selected ? 'Deselect' : 'Select'}
          >
            <span
              className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                selected
                  ? 'border-blue-500 bg-blue-500'
                  : 'border-[#D4D4D4] dark:border-[#404040]'
              }`}
            >
              {selected && (
                <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                  <path d="M1 4l3 3 5-6" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </span>
          </button>
        )}
        <div
          onClick={handleClick}
          className="flex-1 text-left px-4 py-3 flex gap-2 active:bg-[#F0F0F0] dark:active:bg-[#1A1A1A] transition-colors items-stretch cursor-pointer"
          style={{ paddingLeft: selectionMode ? '0.5rem' : undefined }}
        >
          <CardFacePreview html={front} tagColors={dotColors} />
          <div className="w-px bg-border-light dark:bg-border-dark self-stretch mx-1" />
          <CardFacePreview html={back} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function Browse({ db, deckId, deckName, onBack, onSyncEdit }: BrowseProps) {
  const [cards, setCards] = useState<Card[]>([]);
  const [search, setSearch] = useState('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [editingCard, setEditingCard] = useState<Card | null>(null);
  const [isNewCard, setIsNewCard] = useState(false);

  // Selection mode
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Tag filter and sort
  const [activeTagFilters, setActiveTagFilters] = useState<string[]>([]);

  // Delete confirmation
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Inline title editing
  const [currentDeckName, setCurrentDeckName] = useState(deckName);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');

  const handleTitleSave = useCallback(() => {
    const name = titleDraft.trim();
    setEditingTitle(false);
    if (!name || !db || name === currentDeckName) return;
    const now = Math.floor(Date.now() / 1000);
    const result = renameDeck(db, deckId, name, now);
    if (result.success) {
      setCurrentDeckName(name);
      if (onSyncEdit) {
        onSyncEdit([{ type: 'deck_rename', name }]);
      } else {
        persistAndBackup();
      }
    }
  }, [db, deckId, titleDraft, currentDeckName, onSyncEdit]);

  const { rewriteHtml, addMediaFile } = useDeckMedia(db, deckId);

  const loadCardsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadCards = useCallback(() => {
    if (loadCardsTimer.current) clearTimeout(loadCardsTimer.current);
    if (!db) return;
    // Defer card loading by one tick so the Browse page renders before we
    // block the thread with the full card query.
    loadCardsTimer.current = setTimeout(() => {
      loadCardsTimer.current = null;
      console.time('[Browse] getCardsByDeck');
      const result = getCardsByDeck(db, deckId);
      console.timeEnd('[Browse] getCardsByDeck');
      if (result.success) setCards(result.data);
    }, 0);
  }, [db, deckId]);

  useEffect(() => { loadCards(); }, [loadCards]);
  useEffect(() => () => { if (loadCardsTimer.current) clearTimeout(loadCardsTimer.current); }, []);
  useEffect(() => { setVisibleCount(PAGE_SIZE); }, [search, activeTagFilters]);

  // Deck-level tags for pill bar and card editing
  const [deckTags, setDeckTags] = useState<TagCount[]>([]);
  const loadDeckTags = useCallback(() => {
    if (!db) return;
    const result = getTagsForDeck(db, deckId);
    if (result.success) setDeckTags(sortTagsByColor(result.data));
  }, [db, deckId]);
  useEffect(() => { loadDeckTags(); }, [loadDeckTags]);

  // Build a map of tag → color for dot rendering and sort keys
  const tagColorMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const tc of deckTags) m.set(tc.tag, tc.color || '#9E9E9E');
    return m;
  }, [deckTags]);

  const filtered = useMemo(() => {
    let list = cards;

    // Text search
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(c =>
        stripHtml(c.front).toLowerCase().includes(q) ||
        stripHtml(c.back).toLowerCase().includes(q) ||
        c.tags.some(t => t.toLowerCase().includes(q)),
      );
    }

    // When tags are selected: sort tagged cards to top, untagged below (no filtering out)
    if (activeTagFilters.length > 0) {
      list = [...list].sort((a, b) => {
        const aHas = activeTagFilters.some(t => a.tags.includes(t));
        const bHas = activeTagFilters.some(t => b.tags.includes(t));
        if (aHas && !bHas) return -1;
        if (!aHas && bHas) return 1;
        return 0;
      });
    }

    return list;
  }, [cards, search, activeTagFilters]);

  const visible = filtered.slice(0, visibleCount);
  const hasMore = visibleCount < filtered.length;

  // ── Editor callbacks ───────────────────────────────────────────────────

  const handleEditorSave = useCallback((updated: Card) => {
    if (isNewCard) {
      setCards(prev => [updated, ...prev]);
    } else {
      setCards(prev => prev.map(c => (c.id === updated.id ? updated : c)));
    }
    setEditingCard(null);
    setIsNewCard(false);
    loadDeckTags(); // refresh pills in case new tags were added
  }, [isNewCard, loadDeckTags]);

  const handleEditorDelete = useCallback(() => {
    const deletedId = editingCard?.id;
    setEditingCard(null);
    setIsNewCard(false);
    if (deletedId) setCards(prev => prev.filter(c => c.id !== deletedId));
  }, [editingCard]);

  const handleAddCard = useCallback(() => {
    hapticTap();
    const now = Math.floor(Date.now() / 1000);
    const blank: Card = { id: uuidv4(), deckId, noteId: null, front: '', back: '', tags: [], createdAt: now, updatedAt: now };
    setIsNewCard(true);
    setEditingCard(blank);
  }, [deckId]);

  // ── Selection callbacks ────────────────────────────────────────────────

  const toggleSelect = useCallback((id: string) => {
    hapticTap();
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const exitSelection = useCallback(() => {
    setSelectionMode(false);
    setSelectedIds(new Set());
    setConfirmDelete(false);
  }, []);

  const handleDeleteSelected = useCallback(() => {
    if (!db || selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    const result = deleteCards(db, ids);
    if (result.success) {
      if (onSyncEdit) {
        onSyncEdit(ids.map(cardId => ({ type: 'card_delete' as const, cardId })));
      } else {
        persistAndBackup();
      }
      setCards(prev => prev.filter(c => !selectedIds.has(c.id)));
      exitSelection();
    }
  }, [db, selectedIds, exitSelection, onSyncEdit]);

  // ── Tag filter toggle ──────────────────────────────────────────────────

  const toggleTagFilter = useCallback((tag: string) => {
    hapticTap();
    setActiveTagFilters(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag],
    );
  }, []);

  // ── Swipe-to-tag / untag ──────────────────────────────────────────────

  const applyTagSwipe = useCallback((card: Card, mode: 'add' | 'remove') => {
    if (!db || activeTagFilters.length === 0) return;
    const updatedTags = mode === 'add'
      ? [...card.tags, ...activeTagFilters.filter(t => !card.tags.includes(t))]
      : card.tags.filter(t => !activeTagFilters.includes(t));
    if (updatedTags.length === card.tags.length && mode === 'add') return;
    if (updatedTags.length === card.tags.length && mode === 'remove') return;
    hapticTap();
    const now = Math.floor(Date.now() / 1000);
    const result = updateCardTags(db, card.id, updatedTags, now);
    if (result.success) {
      setCards(prev => prev.map(c => c.id === card.id ? { ...c, tags: updatedTags } : c));
      if (onSyncEdit) {
        onSyncEdit([{ type: 'card_edit', cardId: card.id, fields: { tags: result.data.tags }, updatedAt: result.data.updatedAt }]);
      } else {
        persistAndBackup();
      }
    }
  }, [db, activeTagFilters, onSyncEdit]);

  const selectedCount = selectedIds.size;

  return (
    <div className="h-[100dvh] flex flex-col bg-[var(--kit-bg)] text-[#1c1c1e] dark:text-[#E5E5E5] overflow-x-hidden">
      {/* Header */}
      <header
        className="flex items-center gap-3 pb-3 border-b border-[#E5E5E5] dark:border-[#262626] shrink-0"
        style={{
          paddingTop: 'calc(env(safe-area-inset-top) + 0.75rem)',
          paddingLeft: 'max(1rem, env(safe-area-inset-left))',
          paddingRight: 'max(1rem, env(safe-area-inset-right))',
        }}
      >
        <button
          onClick={() => { hapticTap(); selectionMode ? exitSelection() : onBack(); }}
          className="p-2 -ml-2 text-[#C4C4C4] hover:text-[#1c1c1e] dark:hover:text-[#E5E5E5] transition-colors shrink-0 text-sm"
          aria-label="Back"
        >
          {selectionMode ? 'Cancel' : (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          )}
        </button>
        {editingTitle && !selectionMode ? (
          <input
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            value={titleDraft}
            onChange={e => setTitleDraft(e.target.value)}
            onBlur={handleTitleSave}
            onKeyDown={e => {
              if (e.key === 'Enter') handleTitleSave();
              if (e.key === 'Escape') setEditingTitle(false);
            }}
            className="flex-1 text-sm font-semibold bg-transparent border-b border-[#1c1c1e] dark:border-[#E5E5E5] outline-none text-[#1c1c1e] dark:text-[#E5E5E5] min-w-0"
          />
        ) : selectionMode ? (
          <span className="flex-1 text-sm font-semibold truncate text-[#1c1c1e] dark:text-[#E5E5E5]">
            {selectedCount > 0 ? `${selectedCount} selected` : 'Select cards'}
          </span>
        ) : (
          <button
            onClick={() => { setTitleDraft(currentDeckName); setEditingTitle(true); }}
            className="flex-1 flex items-center gap-1.5 min-w-0 text-left"
          >
            <span className="text-sm font-semibold truncate text-[#1c1c1e] dark:text-[#E5E5E5] border-b border-dashed border-[#C4C4C4]">
              {currentDeckName}
            </span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-[#C4C4C4]">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
          </button>
        )}
        {!selectionMode && (
          <>
            <span className="text-sm font-bold text-[#1c1c1e] dark:text-[#E5E5E5] shrink-0">
              {filtered.length} {filtered.length === 1 ? 'card' : 'cards'}
            </span>
            <button
              onClick={handleAddCard}
              className="p-2 text-[#C4C4C4] hover:text-[#1c1c1e] dark:hover:text-[#E5E5E5] transition-colors shrink-0"
              aria-label="Add card"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="4" x2="12" y2="20" />
                <line x1="4" y1="12" x2="20" y2="12" />
              </svg>
            </button>
          </>
        )}
      </header>

      {/* Search + sort bar */}
      <div
        className="py-2 border-b border-[#E5E5E5] dark:border-[#262626] shrink-0 flex items-center gap-2"
        style={{
          paddingLeft: 'max(1rem, env(safe-area-inset-left))',
          paddingRight: 'max(1rem, env(safe-area-inset-right))',
        }}
      >
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search cards or tags…"
          className="flex-1 px-3 py-1.5 text-sm bg-[#FFFFFF] dark:bg-[var(--kit-surface)] border border-[#E5E5E5] dark:border-[#262626] rounded-lg text-[#1c1c1e] dark:text-[#E5E5E5]"
        />
      </div>

      {/* Tag pills — deck-level tags */}
      {deckTags.length > 0 && (
        <div
          className="border-b border-[#E5E5E5] dark:border-[#262626] shrink-0"
          style={{
            paddingLeft: 'max(1rem, env(safe-area-inset-left))',
            paddingRight: 'max(1rem, env(safe-area-inset-right))',
          }}
        >
          <div
            className="flex gap-2.5 overflow-x-auto py-3 px-1"
            style={{ scrollbarWidth: 'none' }}
          >
            {deckTags.map(tc => {
              const isActive = activeTagFilters.includes(tc.tag);
              const bg = tc.color || '#8E8E93';
              const textColor = tc.color ? pillTextColor(tc.color) : '#ffffff';
              return (
                <button
                  key={tc.tag}
                  onClick={() => toggleTagFilter(tc.tag)}
                  className="shrink-0 px-3 py-1 text-xs rounded-full transition-all active:scale-95"
                  style={isActive
                    ? { background: bg, color: textColor, boxShadow: `0 0 0 2px var(--kit-bg), 0 0 0 4px ${bg}` }
                    : { background: bg, color: textColor, opacity: 0.45 }
                  }
                >
                  {tc.tag}
                </button>
              );
            })}
          </div>
          {activeTagFilters.length > 0 && (
            <p className="text-[10px] text-[#C4C4C4] pb-1.5">
              Swipe right to tag · left to untag
            </p>
          )}
        </div>
      )}

      {/* Selection toolbar */}
      {selectionMode && selectedCount > 0 && (
        <div
          className="flex items-center gap-2 py-2 border-b border-[#E5E5E5] dark:border-[#262626] shrink-0"
          style={{
            paddingLeft: 'max(1rem, env(safe-area-inset-left))',
            paddingRight: 'max(1rem, env(safe-area-inset-right))',
          }}
        >
          {!confirmDelete ? (
            <button
              onClick={() => { hapticAgain(); setConfirmDelete(true); }}
              className="flex-1 py-2 text-sm font-semibold border border-red-500/40 rounded-lg text-red-500 active:bg-red-50 dark:active:bg-red-950 transition-colors"
            >
              Delete ({selectedCount})
            </button>
          ) : (
            <div className="flex flex-1 gap-1">
              <button
                onClick={() => setConfirmDelete(false)}
                className="flex-1 py-2 text-sm border border-[#E5E5E5] dark:border-[#262626] rounded-lg text-[#C4C4C4]"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteSelected}
                className="flex-1 py-2 text-sm font-semibold bg-red-500 text-white rounded-lg active:opacity-80"
              >
                Confirm
              </button>
            </div>
          )}
        </div>
      )}

      {/* Card list */}
      <div
        className="flex flex-col flex-1 min-h-0 overflow-y-auto overflow-x-hidden"
        style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
      >
        {filtered.length === 0 && (
          <div className="px-4 py-12 text-center">
            <p className="text-sm text-[#C4C4C4]">
              {search.trim() || activeTagFilters.length > 0
                ? 'No cards match your filters'
                : 'No cards in this deck'}
            </p>
          </div>
        )}
        {filtered.length > 0 && (
          <div className="flex items-center px-4 pt-3 pb-1 border-b border-[#E5E5E5] dark:border-[#262626]">
            <span className="flex-1 text-[10px] font-medium text-[#C4C4C4] uppercase tracking-wider">Front</span>
            <div className="w-px h-3 bg-border-light dark:bg-border-dark mx-3" />
            <span className="flex-1 text-[10px] font-medium text-[#C4C4C4] uppercase tracking-wider">Back</span>
          </div>
        )}
        {visible.map(card => (
          <CardPreviewRow
            key={card.id}
            card={card}
            rewriteHtml={rewriteHtml}
            selected={selectedIds.has(card.id)}
            selectionMode={selectionMode}
            tagColorMap={tagColorMap}
            swipeEnabled={activeTagFilters.length > 0}
            onTap={() => setEditingCard(card)}
            onToggleSelect={() => toggleSelect(card.id)}
            onLongPress={() => { hapticTap(); setSelectionMode(true); toggleSelect(card.id); }}
            onSwipeRight={() => applyTagSwipe(card, 'add')}
            onSwipeLeft={() => applyTagSwipe(card, 'remove')}
          />
        ))}
        {hasMore && (
          <button
            onClick={() => setVisibleCount(prev => prev + PAGE_SIZE)}
            className="w-full py-3 text-sm text-[#C4C4C4] border-b border-[#E5E5E5] dark:border-[#262626]"
          >
            Show more ({filtered.length - visibleCount} remaining)
          </button>
        )}
      </div>

      {/* Card Editor overlay */}
      {editingCard && (
        <CardEditor
          db={db}
          card={editingCard}
          rewriteHtml={rewriteHtml}
          onSave={handleEditorSave}
          onDelete={handleEditorDelete}
          onDismiss={() => { setEditingCard(null); setIsNewCard(false); }}
          isNew={isNewCard}
          deckTags={deckTags}
          onMediaAdded={addMediaFile}
          onSyncEdit={onSyncEdit}
        />
      )}
    </div>
  );
}
