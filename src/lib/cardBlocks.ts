import type { CardContentBlock, CardSideContent } from '../types/cardBlocks';

/** Separate top-level card content without flattening imported tables or formatting.
 * @param html - The displayed side HTML, with resolved media URLs.
 * @returns Preserved styles plus ordered editable text and standalone photo sections.
 */
export function parseCardSideContent(html: string): CardSideContent {
  const template = document.createElement('template');
  template.innerHTML = html;
  // Model CSS is not an empty text field, photo, or movable/removable section.
  const styles = [...template.content.querySelectorAll('style')];
  const metadata = styles.map(style => style.outerHTML).join('');
  for (const style of styles) style.remove();
  const blocks: CardContentBlock[] = [];
  let inline = '';
  const push = (kind: CardContentBlock['kind'], content: string) => {
    blocks.push({ id: `initial-${blocks.length}`, kind, html: content });
  };
  const flush = () => { if (inline.trim()) push('text', inline); inline = ''; };
  for (const node of template.content.childNodes) {
    if (node instanceof HTMLImageElement) { flush(); push('image', node.outerHTML); }
    else if (node instanceof HTMLElement && node.tagName === 'VIDEO') { flush(); push('video', node.outerHTML); }
    else if (node instanceof HTMLElement && /^(DIV|P|FIGURE)$/.test(node.tagName) && node.children.length === 1 && node.firstElementChild?.tagName === 'VIDEO' && !node.textContent?.trim()) {
      flush(); push('video', node.outerHTML);
    }
    else if (node instanceof HTMLElement && /^(DIV|P|FIGURE)$/.test(node.tagName) && node.children.length === 1 && node.firstElementChild instanceof HTMLImageElement && !node.textContent?.trim()) {
      flush(); push('image', node.outerHTML);
    } else if (node instanceof HTMLElement && /^(DIV|P|TABLE|UL|OL|BLOCKQUOTE|H[1-6]|SVG)$/.test(node.tagName)) {
      flush(); push('text', node.outerHTML);
    } else if (node instanceof Element) inline += node.outerHTML;
    else if (node.nodeType === Node.TEXT_NODE) {
      const escaped = document.createElement('span'); escaped.textContent = node.textContent; inline += escaped.innerHTML;
    }
  }
  flush();
  return { metadata, blocks: blocks.length ? blocks : [{ id: 'initial-0', kind: 'text', html: '' }] };
}

/** Read the editable sections of a card side; use parseCardSideContent when saving metadata.
 * @param html - Rich card HTML.
 * @returns Editable text and photo sections, excluding imported styles.
 */
export function parseCardBlocks(html: string): CardContentBlock[] {
  return parseCardSideContent(html).blocks;
}

/** Store section order as ordinary portable HTML, without editor controls.
 * @param blocks - Current ordered content.
 * @param metadata - Preserved noneditable imported styles.
 * @returns Side HTML with text boundaries, imported styling and original photo markup intact.
 */
export function serializeCardBlocks(blocks: readonly CardContentBlock[], metadata = ''): string {
  return metadata + blocks.map(block => block.kind !== 'text' || /^\s*<(?:div|p|table|ul|ol|blockquote|h[1-6]|svg|style)\b/i.test(block.html)
    ? block.html : `<div>${block.html}</div>`).join('');
}

/** Find the source used by a standalone editor photo or video, including source children.
 * @param html - Existing media block markup.
 * @returns Its displayed URL, or an empty string for an incomplete block.
 */
export function getCardBlockMediaSource(html: string): string {
  const template = document.createElement('template'); template.innerHTML = html;
  return template.content.querySelector('img[src],video[src],video source[src]')?.getAttribute('src') ?? '';
}

/** Give the editor manual video controls without rewriting the saved/imported markup.
 * @param html - Original media section.
 * @returns Preview-only markup without video autoplay.
 */
export function editorMediaPreview(html: string): string {
  const template = document.createElement('template'); template.innerHTML = html;
  for (const video of template.content.querySelectorAll('video')) {
    video.removeAttribute('autoplay'); video.setAttribute('controls', '');
    video.setAttribute('playsinline', ''); video.setAttribute('preload', 'metadata');
  }
  return template.innerHTML;
}

/** Move one complete section while preserving its contents and identity.
 * @param blocks - Existing section order.
 * @param id - Section to move.
 * @param destination - Desired final zero-based position.
 * @returns The reordered sections; invalid moves leave the order intact.
 */
export function moveCardBlock(blocks: readonly CardContentBlock[], id: string, destination: number): CardContentBlock[] {
  const next = [...blocks];
  const source = next.findIndex(block => block.id === id);
  if (source < 0 || !Number.isInteger(destination)) return next;
  const [block] = next.splice(source, 1);
  if (block) next.splice(Math.max(0, Math.min(next.length, destination)), 0, block);
  return next;
}


/** Identify the non-dragged section before which a drop will insert, or the end slot.
 * @param blocks - Current section order, including the dragged section.
 * @param draggedId - Section being moved.
 * @param destination - Final zero-based position after removing the dragged section.
 * @returns The next section's ID, or null when the drop belongs after all other sections.
 */
export function getCardBlockDropAnchor(blocks: readonly CardContentBlock[], draggedId: string, destination: number): string | null {
  return blocks.filter(block => block.id !== draggedId)[destination]?.id ?? null;
}


const MEDIA_ATTRIBUTES = ['src', 'href', 'xlink:href', 'poster'] as const;
const MEDIA_ELEMENTS = 'img,image,audio,video,source,track';

/** Find strict media attribute changes between successive rewrites of the same source card.
 * @param previousHtml - Earlier incoming display HTML.
 * @param nextHtml - Incoming display HTML after media has resolved.
 * @returns Consistent old-to-resolved URL replacements; unrelated markup is never copied.
 */
export function getCardMediaUrlChanges(previousHtml: string, nextHtml: string): ReadonlyMap<string, string> {
  const previous = document.createElement('template'); previous.innerHTML = previousHtml;
  const next = document.createElement('template'); next.innerHTML = nextHtml;
  const before = [...previous.content.querySelectorAll(MEDIA_ELEMENTS)];
  const after = [...next.content.querySelectorAll(MEDIA_ELEMENTS)];
  const changes = new Map<string, string>();
  const ambiguous = new Set<string>();
  if (before.length !== after.length) return changes;
  for (const [index, element] of before.entries()) {
    const updated = after[index];
    if (!updated || element.tagName !== updated.tagName) continue;
    for (const attribute of MEDIA_ATTRIBUTES) {
      const oldUrl = element.getAttribute(attribute);
      const newUrl = updated.getAttribute(attribute);
      if (!oldUrl || !newUrl || oldUrl === newUrl || !/^(?:blob:|capacitor:|file:|data:|https?:\/\/(?:localhost|127\.0\.0\.1)(?::|\/))/i.test(newUrl)) continue;
      if (changes.has(oldUrl) && changes.get(oldUrl) !== newUrl) ambiguous.add(oldUrl);
      else changes.set(oldUrl, newUrl);
    }
  }
  for (const url of ambiguous) changes.delete(url);
  return changes;
}

/** Refresh only known media attributes in a live or detached section, leaving selection intact.
 * @param root - Section container whose existing nodes must be preserved.
 * @param changes - Strict old-to-resolved URL replacements.
 * @returns Whether any media attribute changed.
 */
export function updateCardMediaAttributes(root: ParentNode, changes: ReadonlyMap<string, string>): boolean {
  let changed = false;
  for (const element of root.querySelectorAll(MEDIA_ELEMENTS)) {
    for (const attribute of MEDIA_ATTRIBUTES) {
      const current = element.getAttribute(attribute);
      const updated = current ? changes.get(current) : undefined;
      if (updated && updated !== current) { element.setAttribute(attribute, updated); changed = true; }
    }
  }
  return changed;
}

/** Apply the same narrow media refresh to an unmounted photo/arrangement section.
 * @param html - Existing edited section HTML.
 * @param changes - Strict old-to-resolved URL replacements.
 * @returns Existing HTML unchanged unless a known media attribute needed refreshing.
 */
export function refreshCardMediaHtml(html: string, changes: ReadonlyMap<string, string>): string {
  const template = document.createElement('template'); template.innerHTML = html;
  return updateCardMediaAttributes(template.content, changes) ? template.innerHTML : html;
}
