import { describe, expect, it } from 'vitest';
import { createDefaultDeckSettings, createEmptyDeckSnapshot } from './deckFactory';

describe('createDefaultDeckSettings', () => {
  it('associates Kit defaults with the requested deck', () => {
    expect(createDefaultDeckSettings('deck-1')).toEqual({
      deckId: 'deck-1',
      newCardsPerDay: 20,
      maxReviewsPerDay: 200,
      againSteps: [1, 10],
      graduatingInterval: 1,
      easyInterval: 4,
      maxInterval: 365,
      leechThreshold: 8,
      desiredRetention: 0.9,
    });
  });
});

describe('createEmptyDeckSnapshot', () => {
  it('creates a complete empty snapshot and trims its name', () => {
    const snapshot = createEmptyDeckSnapshot('  Biology  ', 'deck-1', 1234);

    expect(snapshot.deckId).toBe('deck-1');
    expect(snapshot.deck).toEqual({
      id: 'deck-1',
      name: 'Biology',
      description: '',
      createdAt: 1234,
      updatedAt: 1234,
    });
    expect(snapshot.settings.deckId).toBe('deck-1');
    expect(snapshot.cards).toEqual([]);
    expect(snapshot.deletedCardIds).toEqual([]);
  });

  it('rejects an empty deck name', () => {
    expect(() => createEmptyDeckSnapshot('   ', 'deck-1', 1234)).toThrow(
      'Deck name cannot be empty.',
    );
  });
});
