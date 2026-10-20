import path from 'node:path';
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { ALL_TABLES } from './schema';
import { insertDeck, insertCard, setCardState, getDeckStats, insertReviewLog } from './queries';

let SQL: SqlJsStatic;
beforeAll(async () => { SQL = await initSqlJs({ locateFile: file => path.join(process.cwd(), 'node_modules/sql.js/dist', file) }); });

describe('next session due time', () => {
  it.each(['learning', 'relearning'] as const)('includes a future %s step and ignores suspended cards', state => {
    const db = new SQL.Database();
    try {
      for (const ddl of ALL_TABLES) db.run(ddl);
      const now = 1_000_000;
      expect(insertDeck(db, { id:'deck', name:'Test', description:'', createdAt:now, updatedAt:now }).success).toBe(true);
      for (const [id, due, suspended] of [['step', now+600, false], ['paused', now+60, true]] as const) {
        expect(insertCard(db, { id, deckId:'deck', noteId:null, front:'Question', back:'Answer', tags:[], createdAt:now, updatedAt:now }).success).toBe(true);
        expect(setCardState(db, { cardId:id, due, suspended, stability:1, difficulty:5, elapsedDays:0, scheduledDays:0, reps:1, lapses:0, state, lastReview:now, learningStepIndex:0 }).success).toBe(true);
      }
      const result = getDeckStats(db, 'deck', now);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.nextDue).toBe(now+600);
    } finally { db.close(); }
  });
});


describe('deck statistics reflect actual study history', () => {
  function fixture() {
    const db = new SQL.Database();
    for (const ddl of ALL_TABLES) db.run(ddl);
    insertDeck(db, { id:'deck', name:'Test', description:'', createdAt:0, updatedAt:0 });
    insertCard(db, { id:'card', deckId:'deck', noteId:null, front:'Q', back:'A', tags:[], createdAt:0, updatedAt:0 });
    return db;
  }

  it('counts each scheduled rating, rather than treating repeated attempts as unique cards', () => {
    const db = fixture();
    try {
      const now = Math.floor(new Date(2026, 9, 20, 12).getTime()/1000);
      for (const [index, rating] of (['again', 'hard', 'good', 'easy'] as const).entries()) {
        expect(insertReviewLog(db, { id:`log-${index}`, cardId:'card', rating, reviewedAt:now-index, elapsed:1, scheduledDays:3 }).success).toBe(true);
      }
      const result = getDeckStats(db, 'deck', now);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toMatchObject({ totalCards:1, totalReviews:4, retentionRate:75, currentStreak:1, reviewsPerDay:[0,0,0,0,0,0,4] });
    } finally { db.close(); }
  });

  it('uses local midnight and keeps yesterday’s streak before today’s first review', () => {
    const db = fixture();
    try {
      const now = Math.floor(new Date(2026, 9, 20, 0, 30).getTime()/1000);
      for (const [index, day] of [18,19].entries()) {
        insertReviewLog(db, { id:`log-${index}`, cardId:'card', rating:'good', reviewedAt:Math.floor(new Date(2026,9,day,23,30).getTime()/1000), elapsed:1, scheduledDays:3 });
      }
      const result = getDeckStats(db, 'deck', now);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toMatchObject({ currentStreak:2, reviewsPerDay:[0,0,0,0,1,1,0] });
    } finally { db.close(); }
  });

  it('keeps both ends of a daylight-saving day in the same local bucket', () => {
    const db = fixture();
    try {
      const now = Math.floor(new Date(2026,10,2,0,30).getTime()/1000);
      for (const [index,hour] of [0,23].entries()) {
        insertReviewLog(db, { id:`log-${index}`, cardId:'card', rating:'good', reviewedAt:Math.floor(new Date(2026,10,1,hour,15).getTime()/1000), elapsed:1, scheduledDays:3 });
      }
      const result = getDeckStats(db, 'deck', now);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toMatchObject({ currentStreak:1, reviewsPerDay:[0,0,0,0,0,2,0] });
    } finally { db.close(); }
  });

  it('includes future learning steps in the Learning state total', () => {
    const db = fixture();
    try {
      const now = 1_000_000;
      setCardState(db, { cardId:'card', due:now+600, suspended:false, stability:1, difficulty:5, elapsedDays:0, scheduledDays:0, reps:1, lapses:0, state:'learning', lastReview:now, learningStepIndex:0 });
      const result = getDeckStats(db, 'deck', now);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toMatchObject({ totalCards:1, learningCount:1, newCount:0, reviewCount:0 });
    } finally { db.close(); }
  });
});
