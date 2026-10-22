import path from 'node:path';
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import JSZip from 'jszip';
import { beforeAll, describe, expect, it } from 'vitest';
import { ALL_TABLES, ENABLE_FOREIGN_KEYS } from './schema';
import { runMigrations } from './migrations';
import { addTagToDeck, applyTagMutations, deleteTagFromCards, getCardsByDeck, getCardStatesByDeck, getNotesByDeck, getReviewLogsByDeck, getTagsForDeck, insertCard, insertDeck, insertNote, insertNoteType, insertReviewLog, renameTagInCards, setCardState, upsertTagColor } from './queries';
import { snapshotCurrentState } from '../sync/compact';
import { exportDeckAsApkgFresh } from '../apkg/exporter';
import { configureSqlJsPath } from '../apkg/parser';
import type { Result } from '../../types';

let SQL: SqlJsStatic;
beforeAll(async () => {
  const locateFile = (file: string) => path.join(process.cwd(), 'node_modules/sql.js/dist', file);
  configureSqlJsPath(locateFile); SQL = await initSqlJs({ locateFile });
});
function must<T>(value: Result<T>): T { if (!value.success) throw new Error(value.error); return value.data; }
function fixture(): Database {
  const db = new SQL.Database();
  db.run(ENABLE_FOREIGN_KEYS); for (const ddl of ALL_TABLES) db.run(ddl); runMigrations(db);
  for (const deckId of ['deck-a', 'deck-b']) {
    must(insertDeck(db, { id:deckId, name:deckId, description:'', createdAt:1, updatedAt:1 }));
    must(insertNoteType(db, { id:`model-${deckId}`, deckId, name:'Basic', fields:['Q'], templates:[], css:'', createdAt:1 }));
    must(insertNote(db, { id:`note-${deckId}`, deckId, noteTypeId:`model-${deckId}`, fields:{ Q:'Question' }, tags:['Bio', 'Bio::Cells', 'Merged'], createdAt:1, updatedAt:1 }));
    must(insertCard(db, { id:`card-${deckId}`, deckId, noteId:`note-${deckId}`, front:'Question <img src="original.png">', back:'Answer', tags:['Bio', 'Bio::Cells', 'Merged'], createdAt:1, updatedAt:1 }));
    must(addTagToDeck(db, deckId, 'Bio', 1)); must(addTagToDeck(db, deckId, 'Merged', 1));
  }
  must(upsertTagColor(db, 'Bio', '#123456', 1)); must(upsertTagColor(db, 'Merged', '#abcdef', 1));
  must(setCardState(db, { cardId:'card-deck-a', due:2_000_000_000, stability:21, difficulty:4, elapsedDays:3, scheduledDays:20, reps:10, lapses:2, state:'review', lastReview:1_900_000_000, learningStepIndex:0, suspended:false }));
  must(insertReviewLog(db, { id:'log', cardId:'card-deck-a', rating:'good', reviewedAt:1_900_000_000, elapsed:3, scheduledDays:20 }));
  return db;
}

describe('exact tag edits across storage representations', () => {
  it('merges a rename collision without duplicate tags, stray associations or schedule changes', () => {
    const db = fixture();
    try {
      const states = must(getCardStatesByDeck(db, 'deck-a')), logs = must(getReviewLogsByDeck(db, 'deck-a'));
      expect(must(renameTagInCards(db, 'Bio', 'Merged', 20))).toEqual({ affected:2 });
      for (const id of ['deck-a', 'deck-b']) {
        expect(must(getCardsByDeck(db, id))[0]?.tags).toEqual(['Merged', 'Bio::Cells']);
        expect(must(getNotesByDeck(db, id))[0]?.tags).toEqual(['Merged', 'Bio::Cells']);
        expect(must(getTagsForDeck(db, id))).toEqual([{ tag:'Merged', color:'#abcdef', count:0 }]);
      }
      expect(must(getCardStatesByDeck(db, 'deck-a'))).toEqual(states);
      expect(must(getReviewLogsByDeck(db, 'deck-a'))).toEqual(logs);
      const reopened = new SQL.Database(db.export());
      try { expect(must(getCardsByDeck(reopened, 'deck-a'))[0]?.tags).toEqual(['Merged', 'Bio::Cells']); }
      finally { reopened.close(); }
    } finally { db.close(); }
  });

  it('scopes rename and deletion metadata while preserving another deck and hierarchical descendants', () => {
    const db = fixture();
    try {
      must(renameTagInCards(db, 'Bio', 'Science', 20, 'deck-a'));
      expect(must(getTagsForDeck(db, 'deck-a')).map(tag => tag.tag)).toEqual(['Merged', 'Science']);
      expect(must(getTagsForDeck(db, 'deck-b')).map(tag => tag.tag)).toEqual(['Bio', 'Merged']);
      expect(must(getCardsByDeck(db, 'deck-b'))[0]?.tags).toEqual(['Bio', 'Bio::Cells', 'Merged']);
      expect(must(getNotesByDeck(db, 'deck-b'))[0]?.tags).toEqual(['Bio', 'Bio::Cells', 'Merged']);
      must(deleteTagFromCards(db, 'Science', 30, 'deck-a'));
      expect(must(getCardsByDeck(db, 'deck-a'))[0]?.tags).toEqual(['Bio::Cells', 'Merged']);
      expect(must(getTagsForDeck(db, 'deck-a')).map(tag => tag.tag)).toEqual(['Merged']);
      expect(must(getTagsForDeck(db, 'deck-b')).find(tag => tag.tag === 'Bio')?.color).toBe('#123456');
    } finally { db.close(); }
  });

  it('rolls back card changes when a later note write fails, including inside a sync transaction', () => {
    const db = fixture();
    try {
      db.run("CREATE TRIGGER fail_tag_note BEFORE UPDATE OF tags ON notes BEGIN SELECT RAISE(ABORT, 'note locked'); END");
      db.run('BEGIN');
      expect(renameTagInCards(db, 'Bio', 'Changed', 20).success).toBe(false);
      expect(must(getCardsByDeck(db, 'deck-a'))[0]?.tags[0]).toBe('Bio');
      expect(must(getTagsForDeck(db, 'deck-a')).map(tag => tag.tag)).toEqual(['Bio', 'Merged']);
      db.run('COMMIT');
    } finally { db.close(); }
  });

  it('keeps card-only and standalone colours in snapshots without inventing deck associations', () => {
    const db = fixture();
    try {
      must(upsertTagColor(db, 'Bio::Cells', '#345678', 1)); must(upsertTagColor(db, 'Unused', '#456789', 1));
      const snapshot = snapshotCurrentState(db, 'deck-a', '', new Set());
      expect(snapshot?.tags).toContainEqual({ tag:'Bio::Cells', color:'#345678' });
      expect(snapshot?.tags).toContainEqual({ tag:'Unused', color:'#456789' });
      expect(snapshot?.deckTags).toEqual(['Bio', 'Merged']);
    } finally { db.close(); }
  });

  it('rolls back a whole persisted rename/recolour batch if recolouring fails after the rename', () => {
    const db = fixture();
    try {
      db.run("CREATE TRIGGER fail_tag_color BEFORE UPDATE OF color ON tag_colors WHEN NEW.tag = 'Science' BEGIN SELECT RAISE(ABORT, 'colour locked'); END");
      expect(applyTagMutations(db, 'deck-a', [{ type:'tag_rename', oldTag:'Bio', newTag:'Science' }, { type:'tag_add', tag:'Science', color:'#ff0000' }], 20).success).toBe(false);
      expect(must(getCardsByDeck(db, 'deck-a'))[0]?.tags[0]).toBe('Bio');
      expect(must(getTagsForDeck(db, 'deck-a')).map(tag => tag.tag)).toEqual(['Bio', 'Merged']);
    } finally { db.close(); }
  });

  it('exports renamed/deleted exact tags in real Anki note rows while retaining descendants', async () => {
    const db = fixture();
    try {
      must(renameTagInCards(db, 'Bio', 'Science', 20, 'deck-a'));
      must(deleteTagFromCards(db, 'Merged', 30, 'deck-a'));
      const blob = must(await exportDeckAsApkgFresh(db, 'deck-a', async () => [{ filename:'original.png', data:new Uint8Array([137, 80, 78, 71]), mimeType:'image/png' }]));
      const zip = await JSZip.loadAsync(await blob.arrayBuffer());
      const exported = new SQL.Database(await zip.file('collection.anki2')!.async('uint8array'));
      try { expect(exported.exec('SELECT tags FROM notes')[0]?.values).toEqual([[' Science Bio::Cells ']]); }
      finally { exported.close(); }
    } finally { db.close(); }
  });
});
