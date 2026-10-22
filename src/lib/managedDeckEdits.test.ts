import path from 'node:path';
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { ALL_TABLES } from './db/schema';
import { getDeckById, getDeckSettings, getCardStatesByDeck, getReviewLogsByDeck, insertDeck, insertCard, setCardState, insertReviewLog } from './db/queries';
import { commitManagedDeckName, commitManagedDeckSettings } from './managedDeckEdits';

let SQL: SqlJsStatic;
beforeAll(async () => { SQL = await initSqlJs({ locateFile:file => path.join(process.cwd(),'node_modules/sql.js/dist',file) }); });
function fixture() {
  const db = new SQL.Database();
  for (const ddl of ALL_TABLES) db.run(ddl);
  insertDeck(db,{ id:'deck',name:'Original',description:'',createdAt:10,updatedAt:20 });
  insertCard(db,{ id:'card',deckId:'deck',noteId:null,front:'Question',back:'Answer',tags:['biology'],createdAt:10,updatedAt:20 });
  setCardState(db,{ cardId:'card',due:999999,suspended:true,stability:4,difficulty:6,elapsedDays:2,scheduledDays:5,reps:8,lapses:2,state:'review',lastReview:1234,learningStepIndex:0 });
  insertReviewLog(db,{ id:'log',cardId:'card',rating:'good',reviewedAt:1234,elapsed:2,scheduledDays:5 });
  return db;
}
describe('managed deck saves', () => {
  it.each(['missing receipt','rejected write'])('restores name and timestamp after a %s', async failure => {
    const db = fixture();
    try {
      const before = getDeckById(db,'deck');
      const result = await commitManagedDeckName(db,'deck','Changed', async () => { if (failure === 'rejected write') throw new Error('Storage unavailable'); return null; });
      expect(result.success).toBe(false);
      expect(getDeckById(db,'deck')).toEqual(before);
    } finally { db.close(); }
  });
  it('persists one rename record and preserves the deck identity', async () => {
    const db = fixture();
    try {
      const records:unknown[] = [];
      const result = await commitManagedDeckName(db,'deck','  Art & symbols  ', async ops => { records.push(ops); return 'receipt'; });
      expect(result.success && result.data.name).toBe('Art & symbols');
      expect(result.success && result.data.id).toBe('deck');
      expect(records).toEqual([[{type:'deck_rename',name:'Art & symbols'}]]);
    } finally { db.close(); }
  });
  it('leaves persisted scheduling unchanged until Save and never changes existing progress', async () => {
    const db = fixture();
    try {
      const original = getDeckSettings(db,'deck');
      if (!original.success) throw new Error(original.error);
      const states = getCardStatesByDeck(db,'deck');
      const history = getReviewLogsByDeck(db,'deck');
      const draft = {...original.data,newCardsPerDay:35,againSteps:[2,15],desiredRetention:.93};
      expect(getDeckSettings(db,'deck')).toEqual(original);
      expect((await commitManagedDeckSettings(db,draft,async () => 'receipt')).success).toBe(true);
      expect(getDeckSettings(db,'deck')).toEqual({success:true,data:draft});
      expect(getCardStatesByDeck(db,'deck')).toEqual(states);
      expect(getReviewLogsByDeck(db,'deck')).toEqual(history);
    } finally { db.close(); }
  });
  it('restores the original scheduling after a failed edit write', async () => {
    const db = fixture();
    try {
      const original = getDeckSettings(db,'deck');
      if (!original.success) throw new Error(original.error);
      const result = await commitManagedDeckSettings(db,{...original.data,newCardsPerDay:75},async () => null);
      expect(result.success).toBe(false);
      expect(getDeckSettings(db,'deck')).toEqual(original);
    } finally { db.close(); }
  });
  it('rejects an invalid draft without writing an edit or changing the saved settings', async () => {
    const db = fixture();
    try {
      const original = getDeckSettings(db,'deck');
      if (!original.success) throw new Error(original.error);
      let writes = 0;
      const result = await commitManagedDeckSettings(db,{...original.data,againSteps:[NaN]},async () => { writes++; return 'receipt'; });
      expect(result.success).toBe(false);
      expect(writes).toBe(0);
      expect(getDeckSettings(db,'deck')).toEqual(original);
    } finally { db.close(); }
  });
});
