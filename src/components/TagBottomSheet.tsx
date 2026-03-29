/**
 * TagBottomSheet — iOS-style draggable bottom sheet for tag actions.
 *
 * UI only. All mutations are handled via callbacks (CLAUDE.md: business logic
 * lives in hooks, components only render).
 *
 * Drag behaviour:
 *  - Initial height: 44 % of viewport (collapsed)
 *  - Swipe up past threshold: expand to full height
 *  - Swipe down past threshold: dismiss (calls onClose)
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Deck } from '../types';
import type { DeckAssociation } from '../hooks/useTagSheet';
import type { TagCount } from '../lib/db/queries';
import { TAG_PALETTE, pillTextColor } from '../lib/tagColors';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COLLAPSED_VH = 65;   // percent of viewport height when collapsed
const EXPANDED_VH = 85;    // percent of viewport height when expanded
const EXPAND_THRESHOLD = 60; // px dragged up to trigger full expand
const DISMISS_THRESHOLD = 80; // px dragged down to trigger dismiss

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Flat 8×5 color grid. */
function ColorGrid({
  current,
  onSelect,
}: {
  current: string;
  onSelect: (hex: string) => void;
}) {
  return (
    <div className="grid grid-cols-8 gap-2 px-4 py-3">
      {TAG_PALETTE.map(shade => (
        <button
          key={shade.hex}
          onClick={() => onSelect(shade.hex)}
          className="w-7 h-7 rounded-full active:scale-90 transition-transform"
          style={{
            background: shade.hex,
            boxShadow: current === shade.hex
              ? `0 0 0 2px var(--kit-bg), 0 0 0 4px ${shade.hex}`
              : 'none',
          }}
          aria-label={shade.name}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface TagBottomSheetProps {
  tag: TagCount;
  allDecks?: Deck[];
  deckAssociations?: DeckAssociation[];
  onClose: () => void;
  onRename: (oldTag: string, newTag: string) => boolean | Promise<boolean>;
  onColorChange: (tag: string, hex: string) => void;
  onDelete: (tag: string) => void;
  onAddToDeck?: ((tag: string, deckId: string) => void) | undefined;
  onRemoveFromDeck?: ((tag: string, deckId: string) => void) | undefined;
  onTagUpdated: (newTag: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TagBottomSheet({
  tag,
  allDecks = [],
  deckAssociations = [],
  onClose,
  onRename,
  onColorChange,
  onDelete,
  onAddToDeck,
  onRemoveFromDeck,
  onTagUpdated,
}: TagBottomSheetProps) {
  const [expanded, setExpanded] = useState(false);
  const [dragY, setDragY] = useState(0);
  const dragStartY = useRef(0);
  const isDragging = useRef(false);

  // Inline rename state
  const [renameDraft, setRenameDraft] = useState(tag.tag);
  const [editingName, setEditingName] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editingName) renameInputRef.current?.focus(); }, [editingName]);

  // Deck picker overlay
  const [showDeckPicker, setShowDeckPicker] = useState(false);

  // Delete confirm
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Remove-from-deck confirm
  const [removingDeckId, setRemovingDeckId] = useState<string | null>(null);

  const handleRenameCommit = useCallback(() => {
    const newName = renameDraft.trim();
    setEditingName(false);
    if (!newName || newName === tag.tag) return;
    const ok = onRename(tag.tag, newName);
    if (ok) onTagUpdated(newName);
  }, [renameDraft, tag.tag, onRename, onTagUpdated]);

  // ── Drag handlers ──────────────────────────────────────────────────────

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    dragStartY.current = e.touches[0]!.clientY;
    isDragging.current = true;
    setDragY(0);
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isDragging.current) return;
    const delta = e.touches[0]!.clientY - dragStartY.current;
    setDragY(delta);
  }, []);

  const onTouchEnd = useCallback(() => {
    isDragging.current = false;
    if (dragY < -EXPAND_THRESHOLD) {
      setExpanded(true);
    } else if (dragY > DISMISS_THRESHOLD) {
      onClose();
    }
    setDragY(0);
  }, [dragY, onClose]);

  // ── Computed styles ────────────────────────────────────────────────────

  const baseHeight = expanded ? `${EXPANDED_VH}dvh` : `${COLLAPSED_VH}vh`;
  // When expanded, prevent dragging further up (already near top)
  const upLimit = expanded ? 0 : -60;
  const transform = dragY !== 0 ? `translateY(${Math.max(upLimit, Math.min(dragY, 200))}px)` : undefined;

  const pillBg = tag.color || '#9E9E9E';
  const pillText = tag.color ? pillTextColor(tag.color) : '#ffffff';

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/40"
        onClick={onClose}
      />

      {/* Sheet */}
      <div
        className="fixed bottom-0 left-0 right-0 z-50 flex flex-col bg-[var(--kit-bg)] rounded-t-2xl overflow-hidden transition-[height] duration-200"
        style={{
          height: baseHeight,
          transform,
          transition: isDragging.current ? 'none' : 'height 0.25s ease, transform 0.2s ease',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        {/* Grab bar */}
        <div
          className="flex items-center justify-center pt-3 pb-2 shrink-0 cursor-grab"
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          <div className="w-10 h-1 rounded-full bg-[#D4D4D4] dark:bg-[#404040]" />
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto">
          {/* Tag name */}
          <div className="px-4 pt-2 pb-4 flex items-center gap-3">
            <span
              className="px-3 py-1 rounded-full text-sm font-medium shrink-0"
              style={{ background: pillBg, color: pillText }}
            >
              {tag.tag}
            </span>
            {editingName ? (
              <input
                ref={renameInputRef}
                value={renameDraft}
                onChange={e => setRenameDraft(e.target.value)}
                onBlur={handleRenameCommit}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleRenameCommit();
                  if (e.key === 'Escape') { setEditingName(false); setRenameDraft(tag.tag); }
                }}
                className="flex-1 px-3 py-1.5 text-sm bg-[var(--kit-surface)] border border-[#E5E5E5] dark:border-[#333] rounded-lg text-[#1c1c1e] dark:text-[#E5E5E5] outline-none"
              />
            ) : (
              <button
                onClick={() => setEditingName(true)}
                className="flex-1 text-left text-sm text-[#C4C4C4] border-b border-dashed border-[#C4C4C4]"
              >
                {tag.tag}
              </button>
            )}
          </div>

          {/* Color picker */}
          <div className="border-t border-[#E5E5E5] dark:border-[#262626]">
            <p className="px-4 pt-3 pb-1 text-xs font-medium text-[#C4C4C4] uppercase tracking-wide">
              Color
            </p>
            <ColorGrid
              current={tag.color}
              onSelect={hex => onColorChange(tag.tag, hex === tag.color ? '' : hex)}
            />
            {tag.color && (
              <button
                onClick={() => onColorChange(tag.tag, '')}
                className="mx-4 mb-3 text-xs text-[#C4C4C4]"
              >
                Clear color
              </button>
            )}
          </div>

          {/* Action buttons */}
          <div className="border-t border-[#E5E5E5] dark:border-[#262626] px-4 py-3 flex gap-3">
            {onAddToDeck && (
              <button
                onClick={() => setShowDeckPicker(true)}
                className="flex-1 py-2.5 text-sm font-medium bg-[var(--kit-surface)] border border-[#E5E5E5] dark:border-[#333] rounded-xl text-[#1c1c1e] dark:text-[#E5E5E5] active:opacity-70"
              >
                Add to Deck
              </button>
            )}
            <button
              onClick={() => setConfirmDelete(true)}
              className="flex-1 py-2.5 text-sm font-medium bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-900 rounded-xl text-red-500 active:opacity-70"
            >
              Delete Tag
            </button>
          </div>

          {/* Deck associations (only shown when deck-scoped) */}
          {onAddToDeck && deckAssociations.length > 0 && (
            <div className="border-t border-[#E5E5E5] dark:border-[#262626]">
              <p className="px-4 pt-3 pb-1 text-xs font-medium text-[#C4C4C4] uppercase tracking-wide">
                In Decks
              </p>
              {deckAssociations.map(assoc => (
                <div
                  key={assoc.deckId}
                  className="flex items-center gap-2 px-4 py-3 border-b border-[#F0F0F0] dark:border-[#1E1E1E]"
                >
                  <span className="flex-1 text-sm text-[#1c1c1e] dark:text-[#E5E5E5] truncate">
                    {assoc.deckName}
                  </span>
                  {onRemoveFromDeck && (
                    <button
                      onClick={() => setRemovingDeckId(assoc.deckId)}
                      className="w-6 h-6 flex items-center justify-center rounded-full text-[#C4C4C4] active:text-red-500"
                      aria-label={`Remove from ${assoc.deckName}`}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {onAddToDeck && deckAssociations.length === 0 && (
            <div className="border-t border-[#E5E5E5] dark:border-[#262626] px-4 py-4">
              <p className="text-xs text-[#C4C4C4] text-center">
                Not added to any deck yet
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Deck picker overlay */}
      {showDeckPicker && onAddToDeck && (
        <div className="fixed inset-0 z-[60] flex flex-col bg-[var(--kit-bg)]"
          style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          <div className="flex items-center gap-3 px-4 py-3 border-b border-[#E5E5E5] dark:border-[#262626]">
            <button onClick={() => setShowDeckPicker(false)} className="text-sm text-[#C4C4C4]">
              Done
            </button>
            <span className="flex-1 text-sm font-semibold text-center">Add to Deck</span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {allDecks.length === 0 && (
              <p className="px-4 py-12 text-sm text-[#C4C4C4] text-center">No decks yet</p>
            )}
            {allDecks.map(deck => {
              const isAdded = deckAssociations.some(a => a.deckId === deck.id);
              return (
                <button
                  key={deck.id}
                  onClick={() => {
                    if (isAdded && onRemoveFromDeck) onRemoveFromDeck(tag.tag, deck.id);
                    else if (onAddToDeck) onAddToDeck(tag.tag, deck.id);
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3.5 border-b border-[#F0F0F0] dark:border-[#1E1E1E] active:bg-[#F5F5F5] dark:active:bg-[#1A1A1A]"
                >
                  <span className="flex-1 text-left text-sm text-[#1c1c1e] dark:text-[#E5E5E5] truncate">
                    {deck.name}
                  </span>
                  {isAdded && (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#34C759" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-8">
          <div className="bg-[var(--kit-bg)] rounded-2xl w-full max-w-sm overflow-hidden">
            <div className="px-6 pt-5 pb-4 text-center">
              <p className="text-base font-semibold">Delete "{tag.tag}"?</p>
              <p className="text-sm text-[#C4C4C4] mt-2">
                The tag will be removed from all cards and decks. Cards are kept.
              </p>
            </div>
            <div className="flex border-t border-[#E5E5E5] dark:border-[#333]">
              <button
                onClick={() => setConfirmDelete(false)}
                className="flex-1 py-3.5 text-sm font-medium text-[#1c1c1e] dark:text-[#E5E5E5] active:bg-[#F0F0F0] dark:active:bg-[#262626] border-r border-[#E5E5E5] dark:border-[#333]"
              >
                Cancel
              </button>
              <button
                onClick={() => { setConfirmDelete(false); onDelete(tag.tag); onClose(); }}
                className="flex-1 py-3.5 text-sm font-semibold text-red-500 active:bg-red-50 dark:active:bg-red-950"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Remove-from-deck confirmation */}
      {removingDeckId && onRemoveFromDeck && (() => {
        const deck = deckAssociations.find(a => a.deckId === removingDeckId);
        return deck ? (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-8">
            <div className="bg-[var(--kit-bg)] rounded-2xl w-full max-w-sm overflow-hidden">
              <div className="px-6 pt-5 pb-4 text-center">
                <p className="text-base font-semibold">Remove from "{deck.deckName}"?</p>
                <p className="text-sm text-[#C4C4C4] mt-2">
                  The tag will no longer be available in that deck.
                </p>
              </div>
              <div className="flex border-t border-[#E5E5E5] dark:border-[#333]">
                <button
                  onClick={() => setRemovingDeckId(null)}
                  className="flex-1 py-3.5 text-sm font-medium text-[#1c1c1e] dark:text-[#E5E5E5] active:bg-[#F0F0F0] dark:active:bg-[#262626] border-r border-[#E5E5E5] dark:border-[#333]"
                >
                  Cancel
                </button>
                <button
                  onClick={() => { onRemoveFromDeck(tag.tag, removingDeckId); setRemovingDeckId(null); }}
                  className="flex-1 py-3.5 text-sm font-semibold text-red-500 active:bg-red-50 dark:active:bg-red-950"
                >
                  Remove
                </button>
              </div>
            </div>
          </div>
        ) : null;
      })()}
    </>
  );
}
