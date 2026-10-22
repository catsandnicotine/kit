import { useMemo } from 'react';
import type { Database } from 'sql.js';
import { getTagsForDeck } from '../lib/db/queries';

/** Resolve the stored tag pigments for a card's deck in a practice session.
 * @param db - Current deck database, when present.
 * @param deckId - Deck owning the visible card.
 * @returns A stable name-to-colour map, with no writes or catalogue mutations.
 */
export function useCardTagColors(db: Database | null | undefined, deckId: string | undefined): ReadonlyMap<string, string> {
  return useMemo(() => {
    if (!db || !deckId) return new Map<string, string>();
    const result = getTagsForDeck(db, deckId);
    if (!result.success) {
      console.warn('Could not load card tag colours:', result.error);
      return new Map<string, string>();
    }
    return new Map(result.data.map(tag => [tag.tag, tag.color]));
  }, [db, deckId]);
}
