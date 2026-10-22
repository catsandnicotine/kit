import { v4 as uuidv4 } from 'uuid';
import type { Card } from '../types';

/** Prepare an unsaved card without changing the deck or its study history.
 * @param deckId - The destination deck.
 * @returns A fresh blank draft, persisted only when the user saves it.
 */
export function createCardDraft(deckId: string): Card {
  const now = Math.floor(Date.now() / 1000);
  return { id: uuidv4(), deckId, noteId: null, front: '', back: '', tags: [], createdAt: now, updatedAt: now };
}
