import { describe, expect, it } from 'vitest';
import { createWelcomeDeckSnapshot, WELCOME_DECK_ID } from './welcomeDeck';

describe('createWelcomeDeckSnapshot', () => {
  it('creates a study-ready tutorial deck for the per-deck architecture', () => {
    const snapshot = createWelcomeDeckSnapshot(1234);

    expect(snapshot.deckId).toBe(WELCOME_DECK_ID);
    expect(snapshot.deck.name).toBe('Welcome to Kit');
    expect(snapshot.cards).toHaveLength(5);
    expect(snapshot.cards.every(card => card.deckId === WELCOME_DECK_ID)).toBe(true);
    expect(snapshot.cards.every(card => card.front && card.back)).toBe(true);
    expect(snapshot.deckTags).toEqual(['welcome', 'tutorial', 'cats', 'science']);
    expect(snapshot.cardStates).toEqual([]);
  });

  it('uses stable card IDs so independent devices converge on one tutorial deck', () => {
    const first = createWelcomeDeckSnapshot(1234);
    const second = createWelcomeDeckSnapshot(1234);

    expect(first.cards.map(card => card.id)).toEqual(second.cards.map(card => card.id));
  });
});
