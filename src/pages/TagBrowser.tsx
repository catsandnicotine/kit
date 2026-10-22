import { TagColourPicker } from '../components/TagColourPicker';
import { TagLabel } from '../components/TagLabel';
import { UiIcon } from '../components/UiIcon';
/**
 * TagBrowser — "All Tags" screen.
 *
 * Shows every tag in the global catalog (stored in the deck registry).
 * Tags are displayed as colored pills grouped by color family, sorted
 * by rainbow order then alphabetically within each group.
 * Tapping a pill opens a bottom sheet with rename / recolor / delete actions.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { UseDeckManagerReturn } from '../hooks/useDeckManager';
import type { GlobalTag } from '../lib/sync/types';
import type { TagCount } from '../lib/db/queries';
import { addTagToDeck, removeTagFromDeck, getDecksByTag, upsertTagColor } from '../lib/db/queries';
import type { DeckAssociation } from '../hooks/useTagSheet';
import { hapticTap } from '../lib/platform/haptics';
import { sortTagsByColor, groupTagsByFamily } from '../lib/tagSort';
import { TagBottomSheet } from '../components/TagBottomSheet';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface TagBrowserProps {
  deckManager: UseDeckManagerReturn;
  onBack: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Map GlobalTag[] to TagCount[] for reuse of sorting/grouping utilities.
 *
 * @param tags - Global tags from the registry.
 * @returns TagCount array (count is always 0 since the catalog has no counts).
 */
function toTagCounts(tags: GlobalTag[]): TagCount[] {
  return tags.map(t => ({ tag: t.name, color: t.color, count: 0 }));
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function TagBrowser({ deckManager, onBack }: TagBrowserProps) {
  const [tags, setTags] = useState<TagCount[]>([]);
  const [search, setSearch] = useState('');
  const [selectedTag, setSelectedTag] = useState<TagCount | null>(null);

  // Create tag dialog
  const [showCreateTag, setShowCreateTag] = useState(false);
  const [newTagDraft, setNewTagDraft] = useState('');
  const [newTagColor, setNewTagColor] = useState('');
  const [creating, setCreating] = useState(false);
  const creatingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const associationSeq = useRef(0);
  const newTagInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (showCreateTag) newTagInputRef.current?.focus(); }, [showCreateTag]);

  // ── Load tags from global catalog ───────────────────────────────────────
  const loadTags = useCallback(() => {
    setTags(toTagCounts(deckManager.getGlobalTags()));
  }, [deckManager]);

  useEffect(() => { loadTags(); }, [loadTags]);

  // ── Filtered + sorted + grouped ────────────────────────────────────────
  const grouped = useMemo(() => {
    let list = tags;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(t => t.tag.toLowerCase().includes(q));
    }
    return groupTagsByFamily(sortTagsByColor(list));
  }, [tags, search]);

  // ── Create tag ──────────────────────────────────────────────────────────
  const handleCreateTag = useCallback(async () => {
    const tag = newTagDraft.trim();
    if (!tag) return;
    if (creatingRef.current) return;
    creatingRef.current = true; setCreating(true); setError(null);
    try {
      await deckManager.upsertTag(tag, newTagColor);
      loadTags(); setShowCreateTag(false); setNewTagDraft(''); setNewTagColor('');
    } catch (cause) { console.warn('Could not create tag:', cause); setError('Couldn’t create this tag. Please try again.'); }
    finally { creatingRef.current = false; setCreating(false); }
  }, [deckManager, newTagDraft, newTagColor, loadTags]);

  // ── Rename ──────────────────────────────────────────────────────────────
  const handleRename = useCallback(async (oldTag: string, newTag: string): Promise<boolean> => {
    await deckManager.renameTag(oldTag, newTag);
    loadTags();
    return true;
  }, [deckManager, loadTags]);

  // ── Recolor ─────────────────────────────────────────────────────────────
  const handleColorChange = useCallback(async (tag: string, hex: string) => {
    await deckManager.upsertTag(tag, hex);
    // Optimistic update
    setTags(prev => prev.map(t => t.tag === tag ? { ...t, color: hex } : t));
    setSelectedTag(prev => prev?.tag === tag ? { ...prev, color: hex } : prev);
  }, [deckManager]);

  // ── Delete ──────────────────────────────────────────────────────────────
  const handleDelete = useCallback(async (tag: string) => {
    await deckManager.deleteTag(tag);
    loadTags();
    setSelectedTag(null);
  }, [deckManager, loadTags]);

  // ── Deck associations (add/remove tag from decks) ─────────────────────

  const allDecks = useMemo(
    () => deckManager.deckEntries.map(e => ({ id: e.deckId, name: e.name, description: '', createdAt: 0, updatedAt: 0 })),
    [deckManager.deckEntries],
  );

  const [deckAssociations, setDeckAssociations] = useState<DeckAssociation[]>([]);

  const loadAssociations = useCallback(async (tagName: string, active: () => boolean) => {
    const seq = ++associationSeq.current;
    const assocs: DeckAssociation[] = [];
    try {
      for (const entry of deckManager.deckEntries) {
        const db = await deckManager.openDeckDb(entry.deckId);
        if (!db) throw new Error('A deck is unavailable.');
        const result = getDecksByTag(db, tagName);
        if (!result.success) throw new Error(result.error);
        if (result.data.some(a => a.deckId === entry.deckId)) assocs.push({ deckId:entry.deckId, deckName:entry.name });
      }
      if (active() && seq === associationSeq.current) setDeckAssociations(assocs);
    } catch (cause) {
      console.warn('Could not load tag associations:', cause);
      if (active() && seq === associationSeq.current) setError('Some decks could not be checked. Please try again.');
    }
  }, [deckManager]);

  const selectedTagName = selectedTag?.tag ?? null;
  useEffect(() => {
    let active = true;
    setDeckAssociations([]);
    if (selectedTagName) void loadAssociations(selectedTagName, () => active);
    return () => { active = false; };
  }, [selectedTagName, loadAssociations]);

  const handleAddToDeck = useCallback(async (tag: string, deckId: string) => {
    associationSeq.current++;
    const db = await deckManager.openDeckDb(deckId);
    if (!db) throw new Error('This deck could not be opened.');
    const color = deckManager.getGlobalTags().find(t => t.name === tag)?.color ?? '';
    if (!await deckManager.writeEdit(deckId, [{ type:'deck_tag_add', tag }, { type:'tag_add', tag, color }])) throw new Error('The tag could not be saved.');
    const now = Math.floor(Date.now() / 1000);
    for (const result of [addTagToDeck(db, deckId, tag, now), upsertTagColor(db, tag, color, now)]) if (!result.success) throw new Error(result.error);
    hapticTap();
    const entry = deckManager.deckEntries.find(e => e.deckId === deckId);
    if (entry) setDeckAssociations(prev => prev.some(a => a.deckId === deckId) ? prev : [...prev, { deckId, deckName:entry.name }]);
  }, [deckManager]);

  const handleRemoveFromDeck = useCallback(async (tag: string, deckId: string) => {
    associationSeq.current++;
    const db = await deckManager.openDeckDb(deckId);
    if (!db) throw new Error('This deck could not be opened.');
    if (!await deckManager.writeEdit(deckId, [{ type:'deck_tag_remove', tag }])) throw new Error('The tag could not be saved.');
    const result = removeTagFromDeck(db, deckId, tag);
    if (!result.success) throw new Error(result.error);
    hapticTap();
    setDeckAssociations(prev => prev.filter(a => a.deckId !== deckId));
  }, [deckManager]);


  return (
    <div className="min-h-[100dvh] flex flex-col bg-[var(--kit-bg)] text-[#1c1c1e] dark:text-[#E5E5E5] page-enter">
      {/* Header */}
      <header
        className="flex items-center gap-3 border-b border-[#E5E5E5] dark:border-[#262626] shrink-0"
        style={{
          minHeight: 'calc(64px + env(safe-area-inset-top))',
          paddingTop: 'env(safe-area-inset-top)',
          paddingLeft: 'max(1rem, env(safe-area-inset-left))',
          paddingRight: 'max(1rem, env(safe-area-inset-right))',
        }}
      >
        <button
          onClick={() => { hapticTap(); onBack(); }}
          className="kit-icon-button text-[#C4C4C4] shrink-0"
          aria-label="Back"
        >
          <UiIcon name="back" />
        </button>
        <span className="text-base font-bold truncate flex-1">
          Tags
        </span>
        <button
          onClick={() => { hapticTap(); setShowCreateTag(true); }}
          className="kit-icon-button text-[#C4C4C4] shrink-0"
          aria-label="New tag"
        >
          <UiIcon name="plus" />
        </button>
      </header>

      {/* Search */}
      <div
        className="py-2 shrink-0"
        style={{
          paddingLeft: 'max(1rem, env(safe-area-inset-left))',
          paddingRight: 'max(1rem, env(safe-area-inset-right))',
        }}
      >
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search tags…"
          className="w-full px-4 py-2 text-sm bg-[var(--kit-surface)] rounded-full text-[#1c1c1e] dark:text-[#E5E5E5] placeholder-[#C4C4C4] outline-none"
        />
      </div>

      {error && !showCreateTag && <p role="alert" className="px-4 py-2 text-sm text-red-500">{error}</p>}
      {/* Tag pills grouped by color family */}
      <div
        className="flex-1 overflow-auto"
        style={{
          paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))',
        }}
      >
        {grouped.size === 0 && (
          <div className="px-4 py-12 text-center">
            <p className="text-sm text-[#C4C4C4]">
              {search.trim() ? 'No tags match your search' : 'No tags yet'}
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
                const isActive = selectedTag?.tag === tc.tag;

                return (
                  <button
                    key={tc.tag}
                    onClick={() => {
                      hapticTap();
                      setSelectedTag(tc);
                    }}
                    className="tag-control"
                    style={{ opacity:selectedTag && !isActive ? .5 : 1 }}
                  >
                    <TagLabel name={tc.tag} color={tc.color} />
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
          key={selectedTag.tag}
          tag={selectedTag}
          allDecks={allDecks}
          deckAssociations={deckAssociations}
          onClose={() => setSelectedTag(null)}
          onRename={(oldTag, newTag) => handleRename(oldTag, newTag)}
          onColorChange={(tag, hex) => handleColorChange(tag, hex)}
          onDelete={tag => handleDelete(tag)}
          onAddToDeck={handleAddToDeck}
          onRemoveFromDeck={handleRemoveFromDeck}
          onTagUpdated={newName => { setSelectedTag(prev => prev ? { ...prev, tag: newName } : null); }}
        />
      )}

      {/* Create tag dialog */}
      {showCreateTag && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-8">
          <div className="bg-[var(--kit-surface)] rounded-2xl w-full max-w-sm overflow-hidden">
            <div className="px-6 pt-5 pb-4">
              <p className="text-base font-semibold text-center mb-4">New tag</p>
              <input
                ref={newTagInputRef}
                type="text"
                value={newTagDraft}
                onChange={e => setNewTagDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleCreateTag(); }}
                placeholder="Tag name"
                className="w-full px-4 py-2.5 text-sm bg-[var(--kit-surface)] rounded-full text-[#1c1c1e] dark:text-[#E5E5E5] placeholder-[#C4C4C4] outline-none"
              />
              {error && <p role="alert" className="mt-3 text-sm text-red-500">{error}</p>}
              <div className="mt-3"><TagColourPicker value={newTagColor} onChange={setNewTagColor} /></div>
            </div>
            <div className="flex border-t border-[#E5E5E5] dark:border-[#333]">
              <button
                disabled={creating} onClick={() => { setShowCreateTag(false); setNewTagDraft(''); setNewTagColor(''); }}
                className="flex-1 py-3.5 text-sm font-medium text-[#1c1c1e] dark:text-[#E5E5E5] active:bg-[#F0F0F0] dark:active:bg-[#262626] border-r border-[#E5E5E5] dark:border-[#333]"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateTag}
                disabled={creating || !newTagDraft.trim()}
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
