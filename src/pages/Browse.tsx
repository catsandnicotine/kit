/**
 * Browse page — visual card browser with selection, tag filter, sort, and review pass.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Database } from 'sql.js';
import type { Card } from '../types';
import { getCardsByDeck, deleteCards } from '../lib/db/queries';
import { v4 as uuidv4 } from 'uuid';
import { useDeckMedia } from '../hooks/useDeckMedia';
import { CardEditor } from '../components/CardEditor';
import { ReviewPassView } from '../components/ReviewPassView';
import { hapticAgain, hapticTap } from '../lib/platform/haptics';
import { persistAndBackup } from '../hooks/useDatabase';

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
        className="browse-card-preview card-content bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark rounded-md overflow-hidden relative"
        style={{ minHeight: '4.5rem' }}
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
      className={`flex items-center border-b border-border-light dark:border-border-dark transition-colors ${
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

export default function Browse({ db, deckId, deckName, onBack }: BrowseProps) {
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

  const { rewriteHtml } = useDeckMedia(db, deckId);

  const loadCards = useCallback(() => {
    if (!db) return;
    const result = getCardsByDeck(db, deckId);
    if (result.success) setCards(result.data);
  }, [db, deckId]);

  useEffect(() => { loadCards(); }, [loadCards]);
  useEffect(() => { setVisibleCount(PAGE_SIZE); }, [search, activeTagFilters, sortByTag]);

  // All unique tags across the deck's cards
  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const c of cards) for (const t of c.tags) if (t) set.add(t);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [cards]);

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
      persistAndBackup();
      setCards(prev => prev.filter(c => !selectedIds.has(c.id)));
      exitSelection();
    }
  }, [db, selectedIds, exitSelection]);

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
        contextLabel={deckName}
        rewriteHtml={rewriteHtml}
        onDone={() => setReviewPassCards(null)}
      />
    );
  }

  const selectedCount = selectedIds.size;

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background-light dark:bg-background-dark text-text-light dark:text-text-dark">
      {/* Header */}
      <header
        className="flex items-center gap-3 pb-3 border-b border-border-light dark:border-border-dark shrink-0"
        style={{
          paddingTop: 'env(safe-area-inset-top)',
          paddingLeft: 'max(1rem, env(safe-area-inset-left))',
          paddingRight: 'max(1rem, env(safe-area-inset-right))',
        }}
      >
        <button
          onClick={() => { hapticTap(); selectionMode ? exitSelection() : onBack(); }}
          className="text-sm text-text-muted shrink-0"
        >
          {selectionMode ? 'Cancel' : '← Back'}
        </button>
        <span className="text-sm font-semibold truncate flex-1">
          {selectionMode
            ? selectedCount > 0 ? `${selectedCount} selected` : 'Select cards'
            : deckName}
        </span>
        {!selectionMode && (
          <>
            <span className="text-xs text-text-muted shrink-0">
              {filtered.length} {filtered.length === 1 ? 'card' : 'cards'}
            </span>
            <button
              onClick={() => { hapticTap(); setSelectionMode(true); }}
              className="text-xs font-medium text-text-muted shrink-0 px-1"
            >
              Select
            </button>
            <button
              onClick={handleAddCard}
              className="w-7 h-7 flex items-center justify-center rounded-full border border-[#D4D4D4] dark:border-[#404040] text-[#C4C4C4] text-lg leading-none shrink-0 active:bg-[#F0F0F0] dark:active:bg-[#1A1A1A]"
              aria-label="Add card"
            >
              +
            </button>
          </>
        )}
      </header>

      {/* Search + sort bar */}
      <div
        className="py-2 border-b border-border-light dark:border-border-dark shrink-0 flex items-center gap-2"
        style={{
          paddingLeft: 'max(1rem, env(safe-area-inset-left))',
          paddingRight: 'max(1rem, env(safe-area-inset-right))',
        }}
      >
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search cards or tags…"
          className="flex-1 px-3 py-1.5 text-sm bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark rounded-lg text-text-light dark:text-text-dark"
        />
        {allTags.length > 0 && (
          <button
            onClick={() => { hapticTap(); setSortByTag(v => !v); }}
            className={`shrink-0 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
              sortByTag
                ? 'bg-[#1c1c1e] dark:bg-[#E5E5E5] text-white dark:text-[#0A0A0A] border-[#1c1c1e] dark:border-[#E5E5E5]'
                : 'text-text-muted border-border-light dark:border-border-dark'
            }`}
          >
            Tag ↕
          </button>
        )}
      </div>

      {/* Tag filter chips */}
      {allTags.length > 0 && (
        <div
          className="flex gap-2 overflow-x-auto py-2 border-b border-border-light dark:border-border-dark shrink-0"
          style={{
            paddingLeft: 'max(1rem, env(safe-area-inset-left))',
            paddingRight: 'max(1rem, env(safe-area-inset-right))',
            scrollbarWidth: 'none',
          }}
        >
          {allTags.map(tag => (
            <button
              key={tag}
              onClick={() => toggleTagFilter(tag)}
              className={`shrink-0 px-3 py-1 text-xs rounded-full border transition-colors ${
                activeTagFilters.includes(tag)
                  ? 'bg-[#1c1c1e] dark:bg-[#E5E5E5] text-white dark:text-[#0A0A0A] border-[#1c1c1e] dark:border-[#E5E5E5]'
                  : 'text-text-muted border-border-light dark:border-border-dark bg-surface-light dark:bg-surface-dark'
              }`}
            >
              {tag}
            </button>
          ))}
        </div>
      )}

      {/* Selection toolbar */}
      {selectionMode && selectedCount > 0 && (
        <div
          className="flex items-center gap-2 py-2 border-b border-border-light dark:border-border-dark shrink-0"
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
                className="flex-1 py-2 text-sm border border-border-light dark:border-border-dark rounded-lg text-text-muted"
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
            <p className="text-sm text-text-muted">
              {search.trim() || activeTagFilters.length > 0
                ? 'No cards match your filters'
                : 'No cards in this deck'}
            </p>
          </div>
        )}
        {filtered.length > 0 && (
          <div className="flex items-center px-4 pt-3 pb-1 border-b border-border-light dark:border-border-dark">
            <span className="flex-1 text-[10px] font-medium text-text-muted uppercase tracking-wider">Front</span>
            <div className="w-px h-3 bg-border-light dark:bg-border-dark mx-3" />
            <span className="flex-1 text-[10px] font-medium text-text-muted uppercase tracking-wider">Back</span>
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
            className="w-full py-3 text-sm text-text-muted border-b border-border-light dark:border-border-dark"
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
          allTags={allTags}
        />
      )}
    </div>
  );
}
