import { ManageDeckActions } from '../components/ManageDeckActions';
import { InlineConfirmation } from '../components/InlineConfirmation';
import type { UseDeckManagerReturn } from '../hooks/useDeckManager';
import type { CardFace } from '../types/editorUi';
import { UiIcon } from '../components/UiIcon';
import { DeckName } from '../components/DeckName';
/**
 * Browse page — visual card browser with selection, tag filter, sort, and review pass.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Database } from 'sql.js';
import type { Card } from '../types';
import { getCardsByDeck, deleteCards, getTagsForDeck, updateCardTags, type TagCount } from '../lib/db/queries';
import { sortTagsByColor } from '../lib/tagSort';
import { getColorSortKey } from '../lib/tagColors';
import { TagLabel } from '../components/TagLabel';
import { createCardDraft } from '../lib/cardDraft';
import { useDeckMedia } from '../hooks/useDeckMedia';
import { useNoticeAutoDismiss } from '../hooks/useNoticeAutoDismiss';
import { useTheme } from '../hooks/useTheme';
import { CardEditor } from '../components/CardEditor';
import { renderLegacyCardHints } from '../lib/cardHints';
import { hapticTap } from '../lib/platform/haptics';
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
  manager?: UseDeckManagerReturn | undefined;
  initialDetails?: boolean;
  onStats: (name: string) => void;
  onSettings: (name: string) => void;
  onDeleted: () => void;
  /** Automatically open the first-card editor for a newly-created deck. */
  guideFirstCard?: boolean;
  /** Start a study session after the guided first card is saved. */
  onStartStudy?: () => void;
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
  const { theme } = useTheme();
  const bodyClass = theme === 'black' ? 'night_mode black_mode' : theme === 'dark' ? 'night_mode' : '';
  useLayoutEffect(() => {
    if (ref.current) ref.current.innerHTML = `<div class="${bodyClass}"><div class="card">${renderLegacyCardHints(html)}</div></div>`;
  }, [html, bodyClass]);
  return (
    <div className="flex-1 min-w-0 flex flex-col">
      <div
        className="browse-card-preview card-content bg-[#FFFFFF] dark:bg-[var(--kit-surface)] rounded-md relative"
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
  onTap: (face: CardFace) => void;
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

  useEffect(() => () => { if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current); }, []);

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
      didSwipeRef.current = true;
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

  const handleClick = useCallback((face: CardFace = 'front') => {
    if (didSwipeRef.current) return;
    if (selectionMode) onToggleSelect(); else onTap(face);
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
        onTouchCancel={() => { clearLongPress(); swipeOffsetRef.current = 0; didSwipeRef.current = true; handleTouchEnd(); }}
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
          onClick={() => handleClick('front')}
          className="flex-1 text-left px-4 py-3 flex gap-2 active:bg-[#F0F0F0] dark:active:bg-[#1A1A1A] transition-colors items-stretch cursor-pointer"
          style={{ paddingLeft: selectionMode ? '0.5rem' : undefined }}
        >
          <button type="button" className="browse-face-button" aria-label="Edit question" onClick={event => { event.stopPropagation(); handleClick('front'); }}><CardFacePreview html={front} tagColors={dotColors} /></button>
          <div className="w-px bg-border-light dark:bg-border-dark self-stretch mx-1" />
          <button type="button" className="browse-face-button" aria-label="Edit answer" onClick={event => { event.stopPropagation(); handleClick('back'); }}><CardFacePreview html={back} /></button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function Browse({
  db,
  deckId,
  deckName,
  onBack,
  manager,
  initialDetails = false,
  onStats,
  onSettings,
  onDeleted,
  guideFirstCard = false,
  onStartStudy,
  onSyncEdit,
}: BrowseProps) {
  const [cards, setCards] = useState<Card[]>([]);
  const [cardsLoading, setCardsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [editingCard, setEditingCard] = useState<Card | null>(() => guideFirstCard ? createCardDraft(deckId) : null);
  const [isNewCard, setIsNewCard] = useState(guideFirstCard);
  const [showPracticePrompt, setShowPracticePrompt] = useState(false);
  const savedCardNotice = useNoticeAutoDismiss({ identity: 'first-card-saved', visible: showPracticePrompt, delayMs: 4000, onDismiss: () => setShowPracticePrompt(false) });
  const guideStartedRef = useRef(guideFirstCard);
  const guidePromptedRef = useRef(false);

  // Selection mode
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Tag filter and sort
  const [activeTagFilters, setActiveTagFilters] = useState<string[]>([]);

  // Delete confirmation
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [currentDeckName, setCurrentDeckName] = useState(deckName);
  const [detailsOpen, setDetailsOpen] = useState(initialDetails);
  const [nameDraft, setNameDraft] = useState(deckName);
  const [discardName, setDiscardName] = useState(false);
  const [manageBusy, setManageBusy] = useState(false);
  const [error, setError] = useState('');
  const [editingFace, setEditingFace] = useState<CardFace>('front');

  const { rewriteHtml, addMediaFile, loading:mediaLoading } = useDeckMedia(db, deckId);

  const loadCardsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadCards = useCallback(() => {
    if (loadCardsTimer.current) clearTimeout(loadCardsTimer.current);
    if (!db) return;
    // Defer card loading by one tick so the Browse page renders before we
    // block the thread with the full card query.
    loadCardsTimer.current = setTimeout(() => {
      loadCardsTimer.current = null;
      const result = getCardsByDeck(db, deckId);
      if (result.success) setCards(result.data); else setError('Couldn’t load these cards. Go back and reopen this deck.');
      setCardsLoading(false);
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
    if (isNewCard && guideFirstCard && guideStartedRef.current && !guidePromptedRef.current) {
      guidePromptedRef.current = true;
      setShowPracticePrompt(true);
    }
  }, [isNewCard, loadDeckTags, guideFirstCard]);

  const handleEditorDelete = useCallback(() => {
    const deletedId = editingCard?.id;
    setEditingCard(null);
    setIsNewCard(false);
    if (deletedId) setCards(prev => prev.filter(c => c.id !== deletedId));
  }, [editingCard]);

  const handleAddCard = useCallback(() => {
    hapticTap();
    setIsNewCard(true);
    setEditingFace('front');
    setEditingCard(createCardDraft(deckId));
  }, [deckId]);

  useEffect(() => {
    if (!guideFirstCard || !db || guideStartedRef.current) return;
    guideStartedRef.current = true;
    handleAddCard();
  }, [guideFirstCard, db, handleAddCard]);

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

  const goBack = () => {
    if (manageBusy) return;
    if (selectionMode) exitSelection();
    else if (detailsOpen) {
      if (nameDraft.trim() !== currentDeckName) setDiscardName(true);
      else setDetailsOpen(false);
    } else onBack();
  };

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
    } else setError('Couldn’t delete those cards. Try again.');
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
      <header className="manage-deck-header">
        <button type="button" onClick={() => { hapticTap(); goBack(); }} disabled={manageBusy} className="kit-icon-button" aria-label={selectionMode ? 'Cancel selection' : 'Back'}><UiIcon name="back" /></button>
        <div className="manage-deck-heading"><h1>{selectionMode ? `${selectedCount} selected` : 'Manage deck'}</h1><span className="deck-context-label"><DeckName name={currentDeckName} /></span></div>
        {!selectionMode && <>
          {!detailsOpen && <button type="button" className="kit-icon-button" aria-label="Deck details" onClick={() => { hapticTap(); setDetailsOpen(true); }}><UiIcon name="more" /></button>}
          {!detailsOpen && cards.length > 0 && <button type="button" className="kit-icon-button" aria-label="Add card" onClick={handleAddCard}><UiIcon name="plus" /></button>}

        </>}
      </header>
      {detailsOpen && <div className="manage-deck-details-scroll">
        {discardName && <InlineConfirmation title="Discard changes?" detail="The deck name hasn’t been saved." cancelLabel="Keep editing" confirmLabel="Discard" onCancel={() => { setDiscardName(false); requestAnimationFrame(() => document.getElementById('manage-deck-name')?.focus()); }} onConfirm={() => { setNameDraft(currentDeckName); setDiscardName(false); setDetailsOpen(false); }} />}
          <div inert={discardName}><ManageDeckActions db={db} deckId={deckId} deckName={currentDeckName} manager={manager} nameDraft={nameDraft} onNameDraftChange={setNameDraft} onBusyChange={setManageBusy} onRenamed={setCurrentDeckName} onDeleted={onDeleted} onStats={() => onStats(currentDeckName)} onSettings={() => onSettings(currentDeckName)} /></div>
      </div>}
      <div hidden={detailsOpen} className="manage-deck-cards">
      {error && <p className="editor-error" role="alert">{error}</p>}
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
          className="flex-1 px-3 py-1.5 text-sm bg-[#FFFFFF] dark:bg-[var(--kit-surface)] rounded-lg text-[#1c1c1e] dark:text-[#E5E5E5]"
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
              return (
                <button
                  key={tc.tag}
                  onClick={() => toggleTagFilter(tc.tag)}
                  className="tag-control shrink-0"
                  aria-pressed={isActive}
                  style={{ opacity:isActive ? 1 : .5 }}
                >
                  <TagLabel name={tc.tag} color={tc.color} />
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
              onClick={() => setConfirmDelete(true)}
              className="flex-1 py-2 text-sm font-semibold rounded-lg text-red-500 active:bg-red-50 dark:active:bg-red-950 transition-colors"
            >
              Delete ({selectedCount})
            </button>
          ) : (
            <InlineConfirmation title={`Delete ${selectedCount} ${selectedCount === 1 ? 'card' : 'cards'}?`} detail="Their study history will also be removed." confirmLabel={selectedCount === 1 ? "Delete card" : "Delete cards"} onCancel={() => setConfirmDelete(false)} onConfirm={handleDeleteSelected} />
          )}
        </div>
      )}

      {/* Card list */}
      <div
        className="flex flex-col flex-1 min-h-0 overflow-y-auto overflow-x-hidden"
        style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
      >
        {!cardsLoading && filtered.length === 0 && (
          <div className="px-6 py-12 text-center flex flex-col items-center">
            <p className="text-sm text-[#C4C4C4]">
              {search.trim() || activeTagFilters.length > 0
                ? 'No cards match your filters'
                : 'No cards in this deck'}
            </p>
            {!search.trim() && activeTagFilters.length === 0 && (
              <>

                <button
                  onClick={handleAddCard}
                  className="mt-5 px-5 py-3 rounded-xl bg-[#1c1c1e] dark:bg-[#E5E5E5] text-white dark:text-[#0A0A0A] text-sm font-semibold active:opacity-80"
                >
                  Add card
                </button>
              </>
            )}
          </div>
        )}
        {filtered.length > 0 && (
          <div className="flex items-center px-4 pt-3 pb-1 border-b border-[#E5E5E5] dark:border-[#262626]">
            <span className="flex-1 text-[10px] font-medium text-[#C4C4C4] uppercase tracking-wider">Front</span>
            <div className="w-px h-3 bg-border-light dark:bg-border-dark mx-3" />
            <span className="flex-1 text-[10px] font-medium text-[#C4C4C4] uppercase tracking-wider">Back</span>
          </div>
        )}
        {(mediaLoading || cardsLoading) && <div className="kit-loading-bar" role="status" aria-label="Loading card media"><div className="kit-loading-fill" /></div>}
        {!mediaLoading && !cardsLoading && visible.map(card => (
          <CardPreviewRow
            key={card.id}
            card={card}
            rewriteHtml={rewriteHtml}
            selected={selectedIds.has(card.id)}
            selectionMode={selectionMode}
            tagColorMap={tagColorMap}
            swipeEnabled={activeTagFilters.length > 0}
            onTap={face => { setEditingFace(face); setEditingCard(card); }}
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
          initialFace={editingFace}
          deckTags={deckTags}
          onMediaAdded={addMediaFile}
          onSyncEdit={onSyncEdit}
        />
      )}

      {showPracticePrompt && <div className="first-card-next" role="status" {...savedCardNotice.events}><span>Card saved</span><button type="button" onClick={() => { hapticTap(); setShowPracticePrompt(false); onStartStudy?.(); }}>Start <UiIcon name="arrow" /></button><button type="button" className="kit-icon-button" aria-label="Dismiss saved card message" onClick={() => setShowPracticePrompt(false)}><UiIcon name="close" /></button></div>}
    </div>
  );
}
