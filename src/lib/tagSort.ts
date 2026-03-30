/**
 * Tag sorting and grouping utilities.
 *
 * Tags with a color from the TAG_PALETTE are sorted by rainbow family order,
 * then by shade (light→dark), then alphabetically within the same shade.
 * Uncolored tags come last, sorted alphabetically.
 */

import { getColorFamily, getColorSortKey, TAG_FAMILIES } from './tagColors';
import type { TagCount } from './db/queries';

/**
 * Sort tags by color (family → shade → alpha), with uncolored tags last.
 *
 * @param tags - Array of TagCount items.
 * @returns New sorted array (does not mutate input).
 */
export function sortTagsByColor(tags: TagCount[]): TagCount[] {
  return [...tags].sort((a, b) => {
    const ka = getColorSortKey(a.color);
    const kb = getColorSortKey(b.color);
    if (ka === -1 && kb === -1) return a.tag.localeCompare(b.tag);
    if (ka === -1) return 1;
    if (kb === -1) return -1;
    if (ka !== kb) return ka - kb;
    return a.tag.localeCompare(b.tag);
  });
}

/**
 * Group tags into an ordered map keyed by color family name.
 * Uncolored tags are keyed under 'No Color'.
 * Map iteration order follows rainbow family order, then 'No Color' last.
 *
 * @param tags - Already-sorted TagCount items (use sortTagsByColor first).
 * @returns Ordered Map of family name → tags in that family.
 */
export function groupTagsByFamily(tags: TagCount[]): Map<string, TagCount[]> {
  const raw = new Map<string, TagCount[]>();

  for (const tag of tags) {
    const key = tag.color ? (getColorFamily(tag.color) ?? 'No Color') : 'No Color';
    const existing = raw.get(key);
    if (existing) {
      existing.push(tag);
    } else {
      raw.set(key, [tag]);
    }
  }

  // Re-order: rainbow families first, then 'No Color'
  const ordered = new Map<string, TagCount[]>();
  for (const family of TAG_FAMILIES) {
    const group = raw.get(family);
    if (group) ordered.set(family, group);
  }
  const noColor = raw.get('No Color');
  if (noColor) ordered.set('No Color', noColor);

  return ordered;
}
