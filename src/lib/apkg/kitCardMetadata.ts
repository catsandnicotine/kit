import type { Result } from '../../types';
import type { KitCardMetadata } from '../../types/apkgMetadata';

/** Validate content-only card metadata before creating imported decks.
 * @param json - kit_cards.json from a Kit export; never includes study records.
 * @returns Exact per-card tags, or an error rather than partial metadata restoration.
 */
export function parseKitCardMetadata(json: string): Result<KitCardMetadata> {
  const error = 'This file’s Kit card details could not be read. Your existing decks have not been replaced.';
  try {
    const raw: unknown = JSON.parse(json);
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw) || !('version' in raw) || raw.version !== 1 || !('cardsById' in raw)
      || typeof raw.cardsById !== 'object' || raw.cardsById === null || Array.isArray(raw.cardsById)) return { success:false, error };
    const cardsById: KitCardMetadata['cardsById'] = Object.create(null) as KitCardMetadata['cardsById'];
    for (const [id, card] of Object.entries(raw.cardsById)) {
      if (!/^\d+$/.test(id) || typeof card !== 'object' || card === null || Array.isArray(card) || !('tags' in card)
        || !Array.isArray(card.tags) || !card.tags.every((tag: unknown): tag is string => typeof tag === 'string')) return { success:false, error };
      cardsById[id] = { tags:[...card.tags] };
    }
    return { success:true, data:{ version:1, cardsById } };
  } catch { return { success:false, error }; }
}
