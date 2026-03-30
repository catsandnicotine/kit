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
import { hapticTap } from '../lib/platform/haptics';
import { TAG_PALETTE, pillTextColor } from '../lib/tagColors';
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
  const newTagInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (showCreateTag) newTagInputRef.current?.focus(); }, [showCreateTag]);

  // ── Load tags from global catalog ───────────────────────────────────────
  const loadTags = useCallback(() => {
    setTags(toTagCounts(deckManager.getGlobalTags()));
  }, [deckManager]);

  useEffect(() => { loadTags(); }, [deckManager]);

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
    await deckManager.upsertTag(tag, newTagColor);
    loadTags();
    setShowCreateTag(false);
    setNewTagDraft('');
    setNewTagColor('');
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

  const totalTags = tags.length;

  return (
    <div className="min-h-[100dvh] flex flex-col bg-[var(--kit-bg)] text-[#1c1c1e] dark:text-[#E5E5E5] page-enter">
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
          onClick={() => { hapticTap(); onBack(); }}
          className="p-2 -ml-2 text-[#C4C4C4] hover:text-[#1c1c1e] dark:hover:text-[#E5E5E5] transition-colors shrink-0"
          aria-label="Back"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <span className="text-sm font-semibold truncate flex-1">
          All Tags
        </span>
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
              {search.trim() ? 'No tags match your search' : 'No tags yet — import a deck or tap + to create one'}
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
                const isActive = selectedTag?.tag === tc.tag;

                return (
                  <button
                    key={tc.tag}
                    onClick={() => {
                      hapticTap();
                      setSelectedTag(tc);
                    }}
                    className="px-3 py-1.5 rounded-full text-sm font-medium active:scale-95 transition-transform"
                    style={{
                      background: bg,
                      color: textColor,
                      boxShadow: isActive
                        ? `0 0 0 3px var(--kit-bg), 0 0 0 5px ${bg}`
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
          onClose={() => setSelectedTag(null)}
          onRename={(oldTag, newTag) => handleRename(oldTag, newTag)}
          onColorChange={(tag, hex) => handleColorChange(tag, hex)}
          onDelete={tag => handleDelete(tag)}
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
    </div>
  );
}
