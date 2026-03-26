/**
 * TagBrowser — manage tags across decks.
 *
 * Features:
 *  - View all unique tags with card counts (optionally scoped to one deck).
 *  - Search/filter tags.
 *  - Select tags to create a new deck from matching cards.
 *  - Rename or delete individual tags.
 *  - Merge: rename one tag into another to consolidate.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Database } from 'sql.js';
import type { Deck } from '../types';
import {
  getAllTagsWithCounts,
  renameTagInCards,
  deleteTagFromCards,
  getCardsByTags,
  insertCardsBatch,
  insertDeck,
  type TagCount,
} from '../lib/db/queries';
import { v4 as uuidv4 } from 'uuid';
import { hapticAgain, hapticTap } from '../lib/platform/haptics';
import { persistAndBackup } from '../hooks/useDatabase';
import { useClickOutside } from '../hooks/useClickOutside';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface TagBrowserProps {
  db: Database | null;
  /** If set, scope the tag list to this deck only. */
  deckId?: string;
  deckName?: string;
  onBack: () => void;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function TagRow({
  tagCount,
  selected,
  selectionMode,
  onToggleSelect,
  onRename,
  onDelete,
}: {
  tagCount: TagCount;
  selected: boolean;
  selectionMode: boolean;
  onToggleSelect: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useClickOutside(menuRef, menuOpen, () => setMenuOpen(false));

  return (
    <div className="flex items-center border-b border-[#E5E5E5] dark:border-[#262626]">
      {selectionMode && (
        <button onClick={onToggleSelect} className="pl-4 pr-2 py-3 shrink-0">
          <span
            className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
              selected ? 'border-blue-500 bg-blue-500' : 'border-[#D4D4D4] dark:border-[#404040]'
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
        onClick={onToggleSelect}
        className={`flex-1 text-left py-3 flex items-center justify-between min-w-0 active:bg-[#F0F0F0] dark:active:bg-[#1A1A1A] transition-colors ${selectionMode ? 'pl-2 pr-4' : 'px-4'}`}
      >
        <span className="text-sm text-[#1c1c1e] dark:text-[#E5E5E5] truncate">{tagCount.tag}</span>
        <span className="text-xs text-[#C4C4C4] ml-3 shrink-0 tabular-nums">
          {tagCount.count} {tagCount.count === 1 ? 'card' : 'cards'}
        </span>
      </button>
      {!selectionMode && (
        <div ref={menuRef} className="relative shrink-0">
          <button
            onClick={() => setMenuOpen(v => !v)}
            className="px-3 py-3 text-sm text-[#C4C4C4]"
            aria-label="Tag actions"
          >
            ···
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 z-10 min-w-[140px] bg-[#FDFBF7] dark:bg-[#1A1A1A] border border-[#E5E5E5] dark:border-[#333] rounded-lg shadow-lg overflow-hidden">
              <button
                onClick={() => { setMenuOpen(false); onRename(); }}
                className="w-full text-left px-4 py-3 text-sm text-[#1c1c1e] dark:text-[#E5E5E5] active:bg-[#F0F0F0] dark:active:bg-[#262626]"
              >
                Rename
              </button>
              <button
                onClick={() => { setMenuOpen(false); onDelete(); }}
                className="w-full text-left px-4 py-3 text-sm text-red-500 active:bg-red-50 dark:active:bg-red-950 border-t border-[#E5E5E5] dark:border-[#333]"
              >
                Delete tag
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function TagBrowser({ db, deckId, deckName, onBack }: TagBrowserProps) {
  const [tags, setTags] = useState<TagCount[]>([]);
  const [search, setSearch] = useState('');
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());

  // Rename dialog
  const [renamingTag, setRenamingTag] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (renamingTag) renameInputRef.current?.focus(); }, [renamingTag]);

  // Delete confirmation
  const [deletingTag, setDeletingTag] = useState<string | null>(null);

  // Create deck from tags
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

  const filtered = useMemo(() => {
    if (!search.trim()) return tags;
    const q = search.trim().toLowerCase();
    return tags.filter(t => t.tag.toLowerCase().includes(q));
  }, [tags, search]);

  // ── Selection ───────────────────────────────────────────────────────────

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

  // ── Rename ──────────────────────────────────────────────────────────────

  const handleRenameConfirm = useCallback(() => {
    if (!db || !renamingTag) return;
    const newTag = renameDraft.trim();
    if (!newTag || newTag === renamingTag) { setRenamingTag(null); return; }
    const now = Math.floor(Date.now() / 1000);
    const result = renameTagInCards(db, renamingTag, newTag, now, deckId);
    if (result.success) {
      persistAndBackup();
      loadTags();
    }
    setRenamingTag(null);
    setRenameDraft('');
  }, [db, renamingTag, renameDraft, deckId, loadTags]);

  // ── Delete ──────────────────────────────────────────────────────────────

  const handleDeleteConfirm = useCallback(() => {
    if (!db || !deletingTag) return;
    const now = Math.floor(Date.now() / 1000);
    const result = deleteTagFromCards(db, deletingTag, now, deckId);
    if (result.success) {
      persistAndBackup();
      loadTags();
    }
    setDeletingTag(null);
  }, [db, deletingTag, deckId, loadTags]);

  // ── Create deck from selected tags ──────────────────────────────────────

  const openCreateDeck = useCallback(() => {
    setDeckNameDraft(Array.from(selectedTags).join(' + '));
    setShowCreateDeck(true);
  }, [selectedTags]);

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

    persistAndBackup();
    hapticTap();
    setShowCreateDeck(false);
    setDeckNameDraft('');
    exitSelection();
  }, [db, deckNameDraft, selectedTags, exitSelection]);

  const selectedCount = selectedTags.size;

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
            onClick={() => { hapticTap(); setSelectionMode(true); }}
            className="text-xs font-medium text-[#C4C4C4] shrink-0 px-1"
          >
            Select
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
            onClick={openCreateDeck}
            className="w-full py-2.5 text-sm font-semibold bg-[#1c1c1e] dark:bg-[#E5E5E5] text-white dark:text-[#0A0A0A] rounded-lg active:opacity-80 transition-opacity"
          >
            Create Deck from {selectedCount} {selectedCount === 1 ? 'tag' : 'tags'}
          </button>
        </div>
      )}

      {/* Tag list */}
      <div
        className="flex flex-col flex-1 min-h-0 overflow-auto"
        style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
      >
        {filtered.length === 0 && (
          <div className="px-4 py-12 text-center">
            <p className="text-sm text-[#C4C4C4]">
              {search.trim() ? 'No tags match your search' : 'No tags yet'}
            </p>
          </div>
        )}
        {filtered.map(tc => (
          <TagRow
            key={tc.tag}
            tagCount={tc}
            selected={selectedTags.has(tc.tag)}
            selectionMode={selectionMode}
            onToggleSelect={() => toggleSelect(tc.tag)}
            onRename={() => { setRenameDraft(tc.tag); setRenamingTag(tc.tag); }}
            onDelete={() => { hapticAgain(); setDeletingTag(tc.tag); }}
          />
        ))}
      </div>

      {/* Rename dialog */}
      {renamingTag && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-8">
          <div className="bg-[#FDFBF7] dark:bg-[#1A1A1A] rounded-2xl w-full max-w-sm overflow-hidden">
            <div className="px-6 pt-5 pb-4">
              <p className="text-base font-semibold text-center mb-4">Rename Tag</p>
              <input
                ref={renameInputRef}
                type="text"
                value={renameDraft}
                onChange={e => setRenameDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleRenameConfirm(); }}
                className="w-full px-3 py-2.5 text-sm bg-[#F0F0F0] dark:bg-[#262626] border border-[#D4D4D4] dark:border-[#404040] rounded-lg text-[#1c1c1e] dark:text-[#E5E5E5] outline-none"
              />
            </div>
            <div className="flex border-t border-[#E5E5E5] dark:border-[#333]">
              <button
                onClick={() => { setRenamingTag(null); setRenameDraft(''); }}
                className="flex-1 py-3.5 text-sm font-medium text-[#1c1c1e] dark:text-[#E5E5E5] active:bg-[#F0F0F0] dark:active:bg-[#262626] border-r border-[#E5E5E5] dark:border-[#333]"
              >
                Cancel
              </button>
              <button
                onClick={handleRenameConfirm}
                disabled={!renameDraft.trim() || renameDraft.trim() === renamingTag}
                className="flex-1 py-3.5 text-sm font-semibold text-[#1c1c1e] dark:text-[#E5E5E5] active:bg-[#F0F0F0] dark:active:bg-[#262626] disabled:opacity-40"
              >
                Rename
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete tag confirmation */}
      {deletingTag && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-8">
          <div className="bg-[#FDFBF7] dark:bg-[#1A1A1A] rounded-2xl w-full max-w-sm overflow-hidden">
            <div className="px-6 pt-5 pb-4 text-center">
              <p className="text-base font-semibold">Delete "{deletingTag}"?</p>
              <p className="text-sm text-[#C4C4C4] mt-2">
                The tag will be removed from all cards. Cards are kept.
              </p>
            </div>
            <div className="flex border-t border-[#E5E5E5] dark:border-[#333]">
              <button
                onClick={() => setDeletingTag(null)}
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

      {/* Create deck name dialog */}
      {showCreateDeck && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-8">
          <div className="bg-[#FDFBF7] dark:bg-[#1A1A1A] rounded-2xl w-full max-w-sm overflow-hidden">
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
