/**
 * TagBrowser — tag management screen.
 *
 * Tags are displayed as colored pills grouped by color family, sorted
 * by rainbow order then alphabetically within each group.
 * Tapping a pill opens a draggable bottom sheet with tag actions.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Database } from 'sql.js';
import type { Deck } from '../types';
import {
  getAllTagsWithCounts,
  getCardsByTags,
  insertCardsBatch,
  insertDeck,
  createStandaloneTag,
  type TagCount,
} from '../lib/db/queries';
import { v4 as uuidv4 } from 'uuid';
import { hapticTap } from '../lib/platform/haptics';
import { persistAndBackup } from '../hooks/useDatabase';
import { TAG_PALETTE, pillTextColor } from '../lib/tagColors';
import { sortTagsByColor, groupTagsByFamily } from '../lib/tagSort';
import { useTagSheet } from '../hooks/useTagSheet';
import { TagBottomSheet } from '../components/TagBottomSheet';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface TagBrowserProps {
  db: Database | null;
  deckId?: string;
  deckName?: string;
  onBack: () => void;
  /** Callback to emit sync edit operations (new per-deck architecture). */
  onSyncEdit?: (ops: import('../lib/sync/types').EditOp[]) => void;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function TagBrowser({ db, deckId, deckName, onBack, onSyncEdit }: TagBrowserProps) {
  const [tags, setTags] = useState<TagCount[]>([]);
  const [search, setSearch] = useState('');
  const [selectedTag, setSelectedTag] = useState<TagCount | null>(null);

  // Create tag dialog
  const [showCreateTag, setShowCreateTag] = useState(false);
  const [newTagDraft, setNewTagDraft] = useState('');
  const [newTagColor, setNewTagColor] = useState('');
  const newTagInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (showCreateTag) newTagInputRef.current?.focus(); }, [showCreateTag]);

  // Create deck from selection
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [showCreateDeck, setShowCreateDeck] = useState(false);
  const [deckNameDraft, setDeckNameDraft] = useState('');
  const deckNameInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (showCreateDeck) deckNameInputRef.current?.focus(); }, [showCreateDeck]);

  const loadTags = useCallback(() => {
    if (!db) return;
    const result = getAllTagsWithCounts(db, deckId);
    if (result.success) setTags(result.data);
  }, [db, deckId]);

  useEffect(() => { loadTags(); }, [loadTags]);

  const handleOptimisticColorChange = useCallback((tag: string, hex: string) => {
    setTags(prev => prev.map(t => t.tag === tag ? { ...t, color: hex } : t));
    // Update selectedTag too if it's the same
    setSelectedTag(prev => prev?.tag === tag ? { ...prev, color: hex } : prev);
  }, []);

  const tagSheet = useTagSheet(db, loadTags, handleOptimisticColorChange, onSyncEdit);

  // Filtered + sorted + grouped
  const grouped = useMemo(() => {
    let list = tags;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(t => t.tag.toLowerCase().includes(q));
    }
    return groupTagsByFamily(sortTagsByColor(list));
  }, [tags, search]);

  // ── Selection (for "Create Deck from tags") ────────────────────────────

  const toggleSelect = useCallback((tag: string) => {
    hapticTap();
    setSelectedTags(prev => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag); else next.add(tag);
      return next;
    });
  }, []);

  const exitSelection = useCallback(() => {
    setSelectionMode(false);
    setSelectedTags(new Set());
  }, []);

  const selectedCount = selectedTags.size;

  // ── Create tag ──────────────────────────────────────────────────────────

  const handleCreateTag = useCallback(() => {
    if (!db) return;
    const tag = newTagDraft.trim();
    if (!tag) return;
    const now = Math.floor(Date.now() / 1000);
    const result = createStandaloneTag(db, tag, newTagColor, now);
    if (result.success) {
      if (onSyncEdit) {
        onSyncEdit([{ type: 'tag_add', tag, color: newTagColor }]);
      } else {
        persistAndBackup();
      }
      loadTags();
    }
    setShowCreateTag(false);
    setNewTagDraft('');
    setNewTagColor('');
  }, [db, newTagDraft, newTagColor, loadTags]);

  // ── Create deck from selected tags ─────────────────────────────────────

  const handleCreateDeck = useCallback(() => {
    if (!db) return;
    const name = deckNameDraft.trim();
    if (!name) return;
    const tagsArray = Array.from(selectedTags);
    const cardsResult = getCardsByTags(db, tagsArray);
    if (!cardsResult.success) return;
    const now = Math.floor(Date.now() / 1000);
    const newDeck: Deck = { id: uuidv4(), name, description: '', createdAt: now, updatedAt: now };
    const deckResult = insertDeck(db, newDeck);
    if (!deckResult.success) return;
    const batchResult = insertCardsBatch(
      db,
      cardsResult.data.map(card => ({
        id: uuidv4(),
        deckId: newDeck.id,
        noteId: null,
        front: card.front,
        back: card.back,
        tags: card.tags,
        createdAt: now,
        updatedAt: now,
      })),
    );
    if (!batchResult.success) return;
    if (!onSyncEdit) {
      persistAndBackup();
    }
    hapticTap();
    setShowCreateDeck(false);
    setDeckNameDraft('');
    exitSelection();
  }, [db, deckNameDraft, selectedTags, exitSelection]);

  const totalTags = tags.length;

  return (
    <div className="min-h-[100dvh] flex flex-col bg-[var(--kit-bg)] text-[#1c1c1e] dark:text-[#E5E5E5]">
      {/* Header */}
      <header
        className="flex items-center gap-3 pb-3 border-b border-[#E5E5E5] dark:border-[#262626] shrink-0"
        style={{
          paddingTop: 'env(safe-area-inset-top)',
          paddingLeft: 'max(1rem, env(safe-area-inset-left))',
          paddingRight: 'max(1rem, env(safe-area-inset-right))',
        }}
      >
        <button
          onClick={() => { hapticTap(); selectionMode ? exitSelection() : onBack(); }}
          className="text-sm text-[#C4C4C4] shrink-0"
        >
          {selectionMode ? 'Cancel' : '← Back'}
        </button>
        <span className="text-sm font-semibold truncate flex-1">
          {selectionMode
            ? selectedCount > 0 ? `${selectedCount} tag${selectedCount !== 1 ? 's' : ''} selected` : 'Select tags'
            : deckId ? `Tags — ${deckName ?? ''}` : 'All Tags'}
        </span>
        {!selectionMode && (
          <button
            onClick={() => { hapticTap(); setShowCreateTag(true); }}
            className="p-2 text-[#C4C4C4] hover:text-[#1c1c1e] dark:hover:text-[#E5E5E5] transition-colors shrink-0"
            aria-label="New tag"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="4" x2="12" y2="20" />
              <line x1="4" y1="12" x2="20" y2="12" />
            </svg>
          </button>
        )}
      </header>

      {/* Search */}
      <div
        className="py-2 border-b border-[#E5E5E5] dark:border-[#262626] shrink-0"
        style={{
          paddingLeft: 'max(1rem, env(safe-area-inset-left))',
          paddingRight: 'max(1rem, env(safe-area-inset-right))',
        }}
      >
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search tags…"
          className="w-full px-3 py-1.5 text-sm bg-[var(--kit-surface)] border border-[#E5E5E5] dark:border-[#262626] rounded-lg text-[#1c1c1e] dark:text-[#E5E5E5] outline-none"
        />
      </div>

      {/* Selection action bar */}
      {selectionMode && selectedCount > 0 && (
        <div
          className="py-2 border-b border-[#E5E5E5] dark:border-[#262626] shrink-0"
          style={{
            paddingLeft: 'max(1rem, env(safe-area-inset-left))',
            paddingRight: 'max(1rem, env(safe-area-inset-right))',
          }}
        >
          <button
            onClick={() => { setDeckNameDraft(Array.from(selectedTags).join(' + ')); setShowCreateDeck(true); }}
            className="w-full py-2.5 text-sm font-semibold bg-[#1c1c1e] dark:bg-[#E5E5E5] text-white dark:text-[#0A0A0A] rounded-lg active:opacity-80 transition-opacity"
          >
            Create Deck from {selectedCount} {selectedCount === 1 ? 'tag' : 'tags'}
          </button>
        </div>
      )}

      {/* Tag pills grouped by color family */}
      <div
        className="flex-1 overflow-auto"
        style={{
          paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))',
        }}
      >
        {totalTags === 0 && (
          <div className="px-4 py-12 text-center">
            <p className="text-sm text-[#C4C4C4]">
              {search.trim() ? 'No tags match your search' : 'No tags yet — tap + New to create one'}
            </p>
          </div>
        )}

        {Array.from(grouped.entries()).map(([family, familyTags]) => (
          <div key={family}>
            {/* Family header */}
            <div
              className="flex items-center gap-2 pt-4 pb-2"
              style={{
                paddingLeft: 'max(1rem, env(safe-area-inset-left))',
                paddingRight: 'max(1rem, env(safe-area-inset-right))',
              }}
            >
              <span className="text-xs font-semibold text-[#C4C4C4] uppercase tracking-wide shrink-0">
                {family}
              </span>
              <div className="flex-1 h-px bg-[#E5E5E5] dark:bg-[#262626]" />
            </div>

            {/* Pills */}
            <div
              className="flex flex-wrap gap-2 pb-2"
              style={{
                paddingLeft: 'max(1rem, env(safe-area-inset-left))',
                paddingRight: 'max(1rem, env(safe-area-inset-right))',
              }}
            >
              {familyTags.map(tc => {
                const bg = tc.color || '#9E9E9E';
                const textColor = tc.color ? pillTextColor(tc.color) : '#ffffff';
                const isSelected = selectedTags.has(tc.tag);
                const isActive = selectedTag?.tag === tc.tag;

                return (
                  <button
                    key={tc.tag}
                    onClick={() => {
                      hapticTap();
                      if (selectionMode) {
                        toggleSelect(tc.tag);
                      } else {
                        setSelectedTag(tc);
                        if (tc.tag !== selectedTag?.tag) tagSheet.reloadAssociations(tc.tag);
                      }
                    }}
                    className="px-3 py-1.5 rounded-full text-sm font-medium active:scale-95 transition-transform"
                    style={{
                      background: bg,
                      color: textColor,
                      opacity: selectionMode && !isSelected ? 0.5 : 1,
                      boxShadow: isActive
                        ? `0 0 0 3px var(--kit-bg), 0 0 0 5px ${bg}`
                        : selectionMode && isSelected
                        ? `0 0 0 2px var(--kit-bg), 0 0 0 4px ${bg}`
                        : 'none',
                    }}
                  >
                    {tc.tag}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Bottom sheet */}
      {selectedTag && (
        <TagBottomSheet
          tag={selectedTag}
          allDecks={tagSheet.allDecks}
          deckAssociations={tagSheet.deckAssociations}
          onClose={() => setSelectedTag(null)}
          onRename={(oldTag, newTag) => tagSheet.renameTag(oldTag, newTag)}
          onColorChange={(tag, hex) => tagSheet.changeColor(tag, hex)}
          onDelete={tag => { tagSheet.deleteTag(tag); setSelectedTag(null); }}
          onAddToDeck={(tag, did) => tagSheet.addToDeck(tag, did)}
          onRemoveFromDeck={(tag, did) => tagSheet.removeFromDeck(tag, did)}
          onTagUpdated={newName => setSelectedTag(prev => prev ? { ...prev, tag: newName } : null)}
        />
      )}

      {/* Create tag dialog */}
      {showCreateTag && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-8">
          <div className="bg-[var(--kit-bg)] rounded-2xl w-full max-w-sm overflow-hidden">
            <div className="px-6 pt-5 pb-4">
              <p className="text-base font-semibold text-center mb-4">New Tag</p>
              <input
                ref={newTagInputRef}
                type="text"
                value={newTagDraft}
                onChange={e => setNewTagDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleCreateTag(); }}
                placeholder="Tag name"
                className="w-full px-3 py-2.5 text-sm bg-[#F0F0F0] dark:bg-[#262626] border border-[#D4D4D4] dark:border-[#404040] rounded-lg text-[#1c1c1e] dark:text-[#E5E5E5] outline-none"
              />
              <div className="mt-3">
                <p className="text-xs text-[#C4C4C4] mb-2">Color (optional)</p>
                <div className="grid grid-cols-8 gap-1.5">
                  {TAG_PALETTE.map(c => (
                    <button
                      key={c.hex}
                      onClick={() => setNewTagColor(newTagColor === c.hex ? '' : c.hex)}
                      className="w-7 h-7 rounded-full active:scale-90 transition-transform"
                      style={{
                        background: c.hex,
                        boxShadow: newTagColor === c.hex ? `0 0 0 2px var(--kit-bg), 0 0 0 4px ${c.hex}` : 'none',
                      }}
                      aria-label={c.name}
                    />
                  ))}
                </div>
              </div>
            </div>
            <div className="flex border-t border-[#E5E5E5] dark:border-[#333]">
              <button
                onClick={() => { setShowCreateTag(false); setNewTagDraft(''); setNewTagColor(''); }}
                className="flex-1 py-3.5 text-sm font-medium text-[#1c1c1e] dark:text-[#E5E5E5] active:bg-[#F0F0F0] dark:active:bg-[#262626] border-r border-[#E5E5E5] dark:border-[#333]"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateTag}
                disabled={!newTagDraft.trim()}
                className="flex-1 py-3.5 text-sm font-semibold text-[#1c1c1e] dark:text-[#E5E5E5] active:bg-[#F0F0F0] dark:active:bg-[#262626] disabled:opacity-40"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create deck dialog */}
      {showCreateDeck && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-8">
          <div className="bg-[var(--kit-bg)] rounded-2xl w-full max-w-sm overflow-hidden">
            <div className="px-6 pt-5 pb-4">
              <p className="text-base font-semibold text-center mb-1">Create Deck</p>
              <p className="text-xs text-[#C4C4C4] text-center mb-4">
                Cards matching selected tags will be copied into a new deck.
              </p>
              <input
                ref={deckNameInputRef}
                type="text"
                value={deckNameDraft}
                onChange={e => setDeckNameDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleCreateDeck(); }}
                placeholder="Deck name"
                className="w-full px-3 py-2.5 text-sm bg-[#F0F0F0] dark:bg-[#262626] border border-[#D4D4D4] dark:border-[#404040] rounded-lg text-[#1c1c1e] dark:text-[#E5E5E5] outline-none"
              />
            </div>
            <div className="flex border-t border-[#E5E5E5] dark:border-[#333]">
              <button
                onClick={() => { setShowCreateDeck(false); setDeckNameDraft(''); }}
                className="flex-1 py-3.5 text-sm font-medium text-[#1c1c1e] dark:text-[#E5E5E5] active:bg-[#F0F0F0] dark:active:bg-[#262626] border-r border-[#E5E5E5] dark:border-[#333]"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateDeck}
                disabled={!deckNameDraft.trim()}
                className="flex-1 py-3.5 text-sm font-semibold text-[#1c1c1e] dark:text-[#E5E5E5] active:bg-[#F0F0F0] dark:active:bg-[#262626] disabled:opacity-40"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
