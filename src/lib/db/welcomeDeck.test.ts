import path from 'node:path';
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { createWelcomeDeckSnapshot, seedWelcomeDeck, WELCOME_DECK_ID } from './welcomeDeck';
import { ALL_TABLES } from './schema';
import { getCardsByDeck, getDeckById, getReviewLogsByDeck, insertCard, insertDeck, insertReviewLog } from './queries';

let SQL: SqlJsStatic;
beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: file => path.join(process.cwd(), 'node_modules/sql.js/dist', file) });
});

describe('createWelcomeDeckSnapshot', () => {
  it('creates five concise cards covering the actual study controls', () => {
    const snapshot = createWelcomeDeckSnapshot(1234);

    expect(snapshot.deckId).toBe(WELCOME_DECK_ID);
    expect(snapshot.deck.name).toBe('Quick start');
    expect(snapshot.cards).toHaveLength(5);
    expect(snapshot.cards.every(card => card.deckId === WELCOME_DECK_ID && card.front && card.back)).toBe(true);
    expect(snapshot.cards.map(card => card.back).join(' ')).toMatch(/Again.*Hard.*Good.*Easy/);
    expect(snapshot.cards[0]?.back).toContain('Try to remember first.');
    expect(snapshot.cards[2]?.back).toContain('eye card below the choices');
    expect(snapshot.cards[2]?.back).toContain('written card returns to the answer');
    expect(snapshot.cards[3]?.back).toContain('without changing its review dates');
    expect(snapshot.cards[4]?.back).toContain('Make cards');
    expect(snapshot.cards[4]?.back).toContain('Import Anki');
    expect(snapshot.deckTags).toEqual(['tutorial']);
    expect(snapshot.cardStates).toEqual([]);
    expect(snapshot.reviewLogs).toEqual([]);
  });

  it('keeps the original deck and card identities across devices and timestamps', () => {
    const first = createWelcomeDeckSnapshot(1234);
    const second = createWelcomeDeckSnapshot(5678);

    expect(first.deckId).toBe('welcome-kit-00000000-0000-0000-0000-000000000001');
    expect(first.cards.map(card => card.id)).toEqual(second.cards.map(card => card.id));
    expect(new Set(first.cards.map(card => card.id)).size).toBe(5);
  });
});

describe('seedWelcomeDeck', () => {
  it('does not rewrite an existing welcome deck, its edited cards, or review history', () => {
    const db = new SQL.Database();
    try {
      for (const ddl of ALL_TABLES) db.run(ddl);
      const deck = { id: WELCOME_DECK_ID, name: 'My edited welcome', description: 'Keep this', createdAt: 1, updatedAt: 2 };
      const card = { id: 'old-welcome-card', deckId: WELCOME_DECK_ID, noteId: null, front: 'My question', back: 'My answer', tags: ['mine'], createdAt: 1, updatedAt: 2 };
      const log = { id: 'old-review', cardId: card.id, rating: 'good' as const, reviewedAt: 100, elapsed: 1, scheduledDays: 3 };
      expect(insertDeck(db, deck).success).toBe(true);
      expect(insertCard(db, card).success).toBe(true);
      expect(insertReviewLog(db, log).success).toBe(true);

      expect(seedWelcomeDeck(db)).toEqual({ success: true, deckId: WELCOME_DECK_ID });
      expect(getDeckById(db, WELCOME_DECK_ID)).toEqual({ success: true, data: deck });
      expect(getCardsByDeck(db, WELCOME_DECK_ID)).toEqual({ success: true, data: [card] });
      expect(getReviewLogsByDeck(db, WELCOME_DECK_ID)).toEqual({ success: true, data: [log] });
    } finally { db.close(); }
  });
});
