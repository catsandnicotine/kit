import { useCallback, useState } from 'react';
import type { Database } from 'sql.js';
import type { Card } from '../types';
import { getCardsByDeck } from '../lib/db/queries';
import { hapticTap } from '../lib/platform/haptics';

/** Continue voluntarily without updating any scheduling or review history.
 * @param db - Open deck database.
 * @param deckId - Deck to practise.
 * @returns Practice cards, an opening action, and close/error state.
 */
export function usePracticeDeck(db: Database | null, deckId: string) {
  const [cards, setCards] = useState<Card[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const start = useCallback(() => {
    if (!db) return;
    const result = getCardsByDeck(db, deckId);
    if (!result.success) { setError('Could not open practice. Try again.'); return; }
    if (!result.data.length) { setError('Add a card to practise.'); return; }
    setError(null);
    void hapticTap();
    setCards(result.data);
  }, [db, deckId]);
  return { cards, start, error, close: () => { void hapticTap(); setCards(null); } };
}
