/**
 * Browse page — visual card browser with selection, tag filter, sort, and review pass.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Database } from 'sql.js';
import type { Card } from '../types';
import { getCardsByDeck, deleteCards, renameDeck, getAllTagsWithCounts, getTagsForDeck, type TagCount } from '../lib/db/queries';
import { sortTagsByColor } from '../lib/tagSort';
import { pillTextColor } from '../lib/tagColors';
import { v4 as uuidv4 } from 'uuid';
import { useDeckMedia } from '../hooks/useDeckMedia';
import { CardEditor } from '../components/CardEditor';
import { ReviewPassView } from '../components/ReviewPassView';
import { hapticAgain, hapticTap } from '../lib/platform/haptics';
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

function CardFacePreview({ html }: { html: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.innerHTML = html;
  }, [html]);
  return (
    <div className="flex-1 min-w-0 flex flex-col">
      <div
        className="browse-card-preview card-content bg-[#FFFFFF] dark:bg-[var(--kit-surface)] border border-[#E5E5E5] dark:border-[#262626] rounded-md overflow-hidden relative"
        style={{ minHeight: '12rem' }}
      >
        <div ref={ref} className="px-2 py-1.5 text-xs leading-relaxed" />
        <div className="browse-card-fade" />
      </div>
    </div>
  );
}

function CardPreviewRow({
  card,
  rewriteHtml,
  selected,
  selectionMode,
  onTap,
  onToggleSelect,
}: {
  card: Card;
  rewriteHtml: (html: string) => string;
  selected: boolean;
  selectionMode: boolean;
  onTap: () => void;
  onToggleSelect: () => void;
}) {
  const front = rewriteHtml(card.front);
  const back = rewriteHtml(card.back);

  return (
    <div
      className={`flex items-center border-b border-[#E5E5E5] dark:border-[#262626] transition-colors ${
        selected ? 'bg-blue-50 dark:bg-blue-950/30' : ''
      }`}
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
      <button
        onClick={selectionMode ? onToggleSelect : onTap}
        className="flex-1 text-left px-4 py-3 flex gap-2 active:bg-[#F0F0F0] dark:active:bg-[#1A1A1A] transition-colors items-stretch"
        style={{ paddingLeft: selectionMode ? '0.5rem' : undefined }}
      >
        <CardFacePreview html={front} />
        <div className="w-px bg-border-light dark:bg-border-dark self-stretch mx-1" />
        <CardFacePreview html={back} />
      </button>
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
  const [sortByTag, setSortByTag] = useState(false);

  // Review pass
  const [reviewPassCards, setReviewPassCards] = useState<Card[] | null>(null);

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
  useEffect(() => { setVisibleCount(PAGE_SIZE); }, [search, activeTagFilters, sortByTag]);

  // All tags (global, sorted by color) for the filter bar
  const [allTags, setAllTags] = useState<TagCount[]>([]);
  const loadAllTags = useCallback(() => {
    if (!db) return;
    const result = getAllTagsWithCounts(db);
    if (result.success) setAllTags(sortTagsByColor(result.data));
  }, [db]);
  useEffect(() => { loadAllTags(); }, [loadAllTags]);

  // Deck-level tags (only tags added to this deck) for card editing
  const [deckTags, setDeckTags] = useState<TagCount[]>([]);
  const loadDeckTags = useCallback(() => {
    if (!db) return;
    const result = getTagsForDeck(db, deckId);
    if (result.success) setDeckTags(sortTagsByColor(result.data));
  }, [db, deckId]);
  useEffect(() => { loadDeckTags(); }, [loadDeckTags]);

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

    // Tag filter
    if (activeTagFilters.length > 0) {
      list = list.filter(c => activeTagFilters.some(t => c.tags.includes(t)));
    }

    // Sort by first tag
    if (sortByTag) {
      list = [...list].sort((a, b) => (a.tags[0] ?? '').localeCompare(b.tags[0] ?? ''));
    }

    return list;
  }, [cards, search, activeTagFilters, sortByTag]);

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
  }, [isNewCard]);

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

  const handleReviewSelected = useCallback(() => {
    const toReview = cards.filter(c => selectedIds.has(c.id));
    if (toReview.length === 0) return;
    hapticTap();
    setReviewPassCards(toReview);
    exitSelection();
  }, [cards, selectedIds, exitSelection]);

  // ── Tag filter toggle ──────────────────────────────────────────────────

  const toggleTagFilter = useCallback((tag: string) => {
    hapticTap();
    setActiveTagFilters(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag],
    );
  }, []);

  // ── Review pass ────────────────────────────────────────────────────────

  if (reviewPassCards) {
    return (
      <ReviewPassView
        cards={reviewPassCards}
        contextLabel={currentDeckName}
        rewriteHtml={rewriteHtml}
        onDone={() => setReviewPassCards(null)}
      />
    );
  }

  const selectedCount = selectedIds.size;

  return (
    <div className="min-h-[100dvh] flex flex-col bg-[var(--kit-bg)] text-[#1c1c1e] dark:text-[#E5E5E5]">
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
            <span className="text-xs text-[#C4C4C4] shrink-0">
              {filtered.length} {filtered.length === 1 ? 'card' : 'cards'}
            </span>
            <button
              onClick={() => { hapticTap(); setSelectionMode(true); }}
              className="text-xs font-medium text-[#C4C4C4] shrink-0 px-1"
            >
              Select
            </button>
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
        {allTags.length > 0 && (
          <button
            onClick={() => { hapticTap(); setSortByTag(v => !v); }}
            className={`shrink-0 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
              sortByTag
                ? 'bg-[#1c1c1e] dark:bg-[#E5E5E5] text-white dark:text-[#0A0A0A] border-[#1c1c1e] dark:border-[#E5E5E5]'
                : 'text-[#C4C4C4] border-[#E5E5E5] dark:border-[#262626]'
            }`}
          >
            Tag ↕
          </button>
        )}
      </div>

      {/* Tag filter chips */}
      {allTags.length > 0 && (
        <div
          className="flex gap-2 overflow-x-auto py-2 border-b border-[#E5E5E5] dark:border-[#262626] shrink-0"
          style={{
            paddingLeft: 'max(1rem, env(safe-area-inset-left))',
            paddingRight: 'max(1rem, env(safe-area-inset-right))',
            scrollbarWidth: 'none',
          }}
        >
          {allTags.map(tc => {
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
          <button
            onClick={handleReviewSelected}
            className="flex-1 py-2 text-sm font-semibold border border-[#D4D4D4] dark:border-[#404040] rounded-lg text-[#1c1c1e] dark:text-[#E5E5E5] active:bg-[#F0F0F0] dark:active:bg-[#1A1A1A] transition-colors"
          >
            Review ({selectedCount})
          </button>
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
        className="flex flex-col flex-1 min-h-0 overflow-auto"
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
            onTap={() => setEditingCard(card)}
            onToggleSelect={() => toggleSelect(card.id)}
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
