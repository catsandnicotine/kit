import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { getCardMediaUrlChanges, moveCardBlock, parseCardSideContent, refreshCardMediaHtml, serializeCardBlocks, updateCardMediaAttributes } from '../lib/cardBlocks';
import { hasMeaningfulCardContent } from '../lib/cardContent';
import { hapticLongPress, hapticTap } from '../lib/platform/haptics';
import type { CardMediaKind } from '../types/cardMedia';
import type { CardContentBlock } from '../types/cardBlocks';

/** Keep ordered side content and portable HTML in step without losing live text selection.
 * @param initialHtml - Existing displayed card HTML.
 * @param onChange - Receives updated side HTML only after a user edit.
 * @returns Editable sections and bounded insert, reorder and remove operations.
 */
export function useCardSideEditor(initialHtml: string, onChange: (html: string) => void) {
  const [content, setContent] = useState(() => parseCardSideContent(initialHtml));
  const blocks = content.blocks;
  const metadataRef = useRef(content.metadata);
  const blocksRef = useRef(blocks);
  const dirtyRef = useRef(false);
  const incomingRef = useRef(initialHtml);
  const setBlocks = useCallback((next: CardContentBlock[]) => {
    setContent({ metadata: metadataRef.current, blocks: next });
  }, []);
  const textRefs = useRef(new Map<string, HTMLDivElement>());
  const activeRef = useRef(blocks[0]?.id ?? '');
  const focusRef = useRef<string | null>(null);
  const [arranging, setArranging] = useState(false);
  const [pendingRemoval, setPendingRemoval] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const readBlocks = useCallback(() => blocksRef.current.map(block => ({ ...block,
    html: block.kind === 'text' ? textRefs.current.get(block.id)?.innerHTML ?? block.html : block.html,
  })), []);
  const getHtml = useCallback(() => serializeCardBlocks(readBlocks(), metadataRef.current), [readBlocks]);
  const commit = useCallback((next: CardContentBlock[]) => {
    dirtyRef.current = true;
    blocksRef.current = next;
    setBlocks(next);
    onChange(serializeCardBlocks(next, metadataRef.current));
  }, [onChange, setBlocks]);

  useLayoutEffect(() => {
    if (incomingRef.current === initialHtml) return;
    const previousHtml = incomingRef.current;
    incomingRef.current = initialHtml;
    if (!dirtyRef.current) {
      const refreshed = parseCardSideContent(initialHtml);
      metadataRef.current = refreshed.metadata;
      blocksRef.current = refreshed.blocks;
      setBlocks(refreshed.blocks);
      if (!refreshed.blocks.some(block => block.id === activeRef.current)) activeRef.current = refreshed.blocks[0]?.id ?? '';
      return;
    }
    // Media can finish loading after the user starts typing. Refresh attributes
    // in existing nodes rather than replacing typed HTML, ordering, or selection.
    const changes = getCardMediaUrlChanges(previousHtml, initialHtml);
    if (!changes.size) return;
    let changed = false;
    const next = readBlocks().map(block => {
      const field = textRefs.current.get(block.id);
      if (field) {
        if (updateCardMediaAttributes(field, changes)) changed = true;
        return { ...block, html: field.innerHTML };
      }
      const html = refreshCardMediaHtml(block.html, changes);
      if (html !== block.html) changed = true;
      return { ...block, html };
    });
    if (changed) { blocksRef.current = next; setBlocks(next); }
  }, [initialHtml, readBlocks, setBlocks]);

  useLayoutEffect(() => {
    if (focusRef.current) {
      textRefs.current.get(focusRef.current)?.focus();
      focusRef.current = null;
    }
  }, [blocks, arranging]);

  const changeText = useCallback((id: string) => {
    activeRef.current = id;
    dirtyRef.current = true;
    const next = readBlocks();
    blocksRef.current = next;
    setBlocks(next);
    // The DOM already holds this exact HTML, so the view leaves the caret alone.
    onChange(serializeCardBlocks(next, metadataRef.current));
  }, [onChange, readBlocks, setBlocks]);

  const addText = useCallback(() => {
    const next = readBlocks();
    const activeIndex = next.findIndex(block => block.id === activeRef.current);
    const active = next[activeIndex];
    const following = next[activeIndex + 1];
    const blank = active?.kind === 'text' && !hasMeaningfulCardContent(active.html) ? active
      : following?.kind === 'text' && !hasMeaningfulCardContent(following.html) ? following : null;
    const block: CardContentBlock = blank ?? { id: crypto.randomUUID(), kind: 'text', html: '' };
    if (!blank) next.splice(activeIndex < 0 ? next.length : activeIndex + 1, 0, block);
    activeRef.current = block.id;
    focusRef.current = block.id;
    setArranging(false);
    if (blank) { blocksRef.current = next; setBlocks(next); }
    else commit(next);
    void hapticTap();
  }, [commit, readBlocks, setBlocks]);

  const insertMedia = useCallback((url: string, kind: CardMediaKind) => {
    const next = readBlocks();
    const media = document.createElement(kind === 'image' ? 'img' : 'video');
    media.setAttribute('src', url);
    if (kind === 'image') media.setAttribute('alt', '');
    else { media.setAttribute('controls', ''); media.setAttribute('playsinline', ''); media.setAttribute('preload', 'metadata'); }
    const block: CardContentBlock = { id: crypto.randomUUID(), kind, html: media.outerHTML };
    const text: CardContentBlock = { id: crypto.randomUUID(), kind: 'text', html: '' };
    const activeIndex = next.findIndex(item => item.id === activeRef.current);
    const active = next[activeIndex];
    const replaceBlank = active?.kind === 'text' && !hasMeaningfulCardContent(active.html);
    next.splice(activeIndex < 0 ? next.length : activeIndex + (replaceBlank ? 0 : 1), replaceBlank ? 1 : 0, block, text);
    activeRef.current = text.id;
    focusRef.current = text.id;
    setArranging(false);
    commit(next);
    void hapticTap();
  }, [commit, readBlocks]);

  const insertImage = useCallback((url: string) => insertMedia(url, 'image'), [insertMedia]);

  const move = useCallback((id: string, destination: number) => {
    const current = readBlocks();
    const next = moveCardBlock(current, id, destination);
    if (next.every((block, index) => block.id === current[index]?.id)) return;
    commit(next);
    const block = next.find(item => item.id === id);
    setAnnouncement(`${block?.kind === 'image' ? 'Photo' : block?.kind === 'video' ? 'Video' : 'Text'} moved to position ${next.findIndex(item => item.id === id) + 1}.`);
    void hapticTap();
  }, [commit, readBlocks]);

  const remove = useCallback((id: string) => {
    const current = readBlocks();
    if (!current.some(block => block.id === id)) return;
    const next = current.filter(block => block.id !== id);
    if (!next.length) next.push({ id: crypto.randomUUID(), kind: 'text', html: '' });
    activeRef.current = next[0]?.id ?? '';
    commit(next);
    setAnnouncement('Section removed. Changes are saved only when you save the card.');
    void hapticTap();
  }, [commit, readBlocks]);

  const toggleArrangement = useCallback(() => {
    const next = readBlocks();
    blocksRef.current = next; setBlocks(next);
    setArranging(value => !value);
    setPendingRemoval(null);
    void hapticTap();
  }, [readBlocks, setBlocks]);
  const beginDrag = useCallback(() => { void hapticLongPress(); }, []);
  const requestRemove = useCallback((id: string) => {
    setPendingRemoval(id);
    void hapticTap();
  }, []);
  const cancelRemove = useCallback(() => setPendingRemoval(null), []);
  const confirmRemove = useCallback(() => {
    if (pendingRemoval) remove(pendingRemoval);
    setPendingRemoval(null);
  }, [pendingRemoval, remove]);
  const focus = useCallback(() => {
    const block = blocksRef.current.find(item => item.kind === 'text');
    if (block) textRefs.current.get(block.id)?.focus();
  }, []);

  return { blocks, metadata: content.metadata, textRefs, activeRef, arranging, pendingRemoval, announcement, changeText, addText, insertImage, insertMedia, move, requestRemove, cancelRemove, confirmRemove, toggleArrangement, beginDrag, focus, getHtml };
}
