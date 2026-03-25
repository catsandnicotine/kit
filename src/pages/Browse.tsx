/**
 * Browse page — visual card browser for a deck, tap to edit.
 *
 * Each card is shown as a mini two-panel preview (front | back) with
 * the actual HTML rendered visually. Cards are paginated (50 at a time)
 * so large decks don't hang the browser.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Database } from 'sql.js';
import type { Card } from '../types';
import { getCardsByDeck } from '../lib/db/queries';
import { v4 as uuidv4 } from 'uuid';
import { useDeckMedia } from '../hooks/useDeckMedia';
import { CardEditor } from '../components/CardEditor';
import { hapticTap } from '../lib/platform/haptics';

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

/** Strip HTML tags for search matching. */
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Mini rendered preview of one side of a card. */
function CardFacePreview({ html, label }: { html: string; label: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.innerHTML = html;
    }
  }, [html]);

  return (
    <div className="flex-1 min-w-0 flex flex-col">
      <span className="text-[10px] text-text-muted mb-0.5 uppercase tracking-wider">
        {label}
      </span>
      <div className="browse-card-preview card-content bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark rounded-md overflow-hidden relative">
        <div ref={ref} className="px-2 py-1.5 text-xs leading-relaxed" />
        <div className="browse-card-fade" />
      </div>
    </div>
  );
}

/** A visual card row showing rendered front and back previews side by side. */
function CardPreviewRow({
  card,
  rewriteHtml,
  onTap,
}: {
  card: Card;
  rewriteHtml: (html: string) => string;
  onTap: () => void;
}) {
  const front = rewriteHtml(card.front);
  const back = rewriteHtml(card.back);

  return (
    <button
      onClick={onTap}
      className="w-full text-left px-4 py-2.5 flex gap-3 border-b border-border-light dark:border-border-dark active:bg-[#F0F0F0] dark:active:bg-[#1A1A1A] transition-colors"
    >
      <CardFacePreview html={front} label="Front" />
      <CardFacePreview html={back} label="Back" />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * Browse all cards in a deck with visual previews. Tap to edit.
 *
 * @param db       - sql.js Database instance (null while loading).
 * @param deckId   - UUID of the deck to browse.
 * @param deckName - Human-readable deck name for the header.
 * @param onBack   - Called when the user navigates back.
 */
export default function Browse({ db, deckId, deckName, onBack }: BrowseProps) {
  const [cards, setCards] = useState<Card[]>([]);
  const [search, setSearch] = useState('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [editingCard, setEditingCard] = useState<Card | null>(null);
  const [isNewCard, setIsNewCard] = useState(false);
  const { rewriteHtml } = useDeckMedia(db, deckId);

  const loadCards = useCallback(() => {
    if (!db) return;
    const result = getCardsByDeck(db, deckId);
    if (result.success) setCards(result.data);
  }, [db, deckId]);

  useEffect(() => {
    loadCards();
  }, [loadCards]);

  // Reset pagination when search changes.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [search]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return cards;
    return cards.filter(c =>
      stripHtml(c.front).toLowerCase().includes(q) ||
      stripHtml(c.back).toLowerCase().includes(q) ||
      c.tags.some(t => t.toLowerCase().includes(q)),
    );
  }, [cards, search]);

  const visible = filtered.slice(0, visibleCount);
  const hasMore = visibleCount < filtered.length;

  const handleEditorSave = useCallback(
    (updated: Card) => {
      if (isNewCard) {
        setCards(prev => [updated, ...prev]);
      } else {
        setCards(prev => prev.map(c => (c.id === updated.id ? updated : c)));
      }
      setEditingCard(null);
      setIsNewCard(false);
    },
    [isNewCard],
  );

  const handleEditorDelete = useCallback(() => {
    const deletedId = editingCard?.id;
    setEditingCard(null);
    setIsNewCard(false);
    if (deletedId) {
      setCards(prev => prev.filter(c => c.id !== deletedId));
    }
  }, [editingCard]);

  const handleAddCard = useCallback(() => {
    hapticTap();
    const now = Math.floor(Date.now() / 1000);
    const blank: Card = {
      id: uuidv4(),
      deckId,
      noteId: null,
      front: '',
      back: '',
      tags: [],
      createdAt: now,
      updatedAt: now,
    };
    setIsNewCard(true);
    setEditingCard(blank);
  }, [deckId]);

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
          onClick={() => { hapticTap(); onBack(); }}
          className="text-sm text-text-muted shrink-0"
        >
          &larr; Back
        </button>
        <span className="text-sm font-semibold truncate">
          {deckName}
        </span>
        <span className="text-xs text-text-muted ml-auto shrink-0">
          {filtered.length} {filtered.length === 1 ? 'card' : 'cards'}
        </span>
        <button
          onClick={handleAddCard}
          className="ml-2 w-7 h-7 flex items-center justify-center rounded-full border border-[#D4D4D4] dark:border-[#404040] text-[#C4C4C4] text-lg leading-none shrink-0 active:bg-[#F0F0F0] dark:active:bg-[#1A1A1A]"
          aria-label="Add card"
        >
          +
        </button>
      </header>

      {/* Search */}
      <div
        className="py-2 border-b border-border-light dark:border-border-dark shrink-0"
        style={{
          paddingLeft: 'max(1rem, env(safe-area-inset-left))',
          paddingRight: 'max(1rem, env(safe-area-inset-right))',
        }}
      >
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search cards…"
          className="w-full px-3 py-1.5 text-sm bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark rounded-lg text-text-light dark:text-text-dark"
        />
      </div>

      {/* Card list */}
      <div
        className="flex flex-col flex-1 min-h-0 overflow-auto"
        style={{
          paddingBottom: 'max(1rem, env(safe-area-inset-bottom))',
          paddingLeft: 'max(1rem, env(safe-area-inset-left))',
          paddingRight: 'max(1rem, env(safe-area-inset-right))',
        }}
      >
        {filtered.length === 0 && (
          <div className="px-4 py-12 text-center">
            <p className="text-sm text-text-muted">
              {search.trim() ? 'No cards match your search' : 'No cards in this deck'}
            </p>
          </div>
        )}
        {visible.map(card => (
          <CardPreviewRow
            key={card.id}
            card={card}
            rewriteHtml={rewriteHtml}
            onTap={() => setEditingCard(card)}
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
        />
      )}
    </div>
  );
}
