import path from 'node:path';
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALL_TABLES } from './db/schema';
import { runMigrations } from './db/migrations';
import { addTagToDeck, getCardsByDeck, getTagsForDeck, insertCard, insertDeck, upsertTagColor } from './db/queries';
import { createGlobalTagMutations } from './globalTagMutations';
import { replayEdits } from './sync/replay';
import type { EditFile, EditOp, GlobalTag } from './sync/types';
import type { Result } from '../types';

let SQL: SqlJsStatic;
const databases: Database[] = [];
beforeAll(async () => { SQL = await initSqlJs({ locateFile:file => path.join(process.cwd(), 'node_modules/sql.js/dist', file) }); });
beforeEach(() => { vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000); });
afterEach(() => { for (const db of databases.splice(0)) db.close(); vi.restoreAllMocks(); });
function must<T>(value: Result<T>): T { if (!value.success) throw new Error(value.error); return value.data; }
function fixture() {
  const decks = new Map<string, Database>();
  const originals = new Map<string, Uint8Array>();
  for (const id of ['deck-a', 'deck-b', 'unrelated']) {
    const db = new SQL.Database(); databases.push(db);
    for (const ddl of ALL_TABLES) db.run(ddl); runMigrations(db);
    must(insertDeck(db, { id, name:id, description:'', createdAt:1, updatedAt:1 }));
    const tags = id === 'unrelated' ? ['Elsewhere'] : ['Bio', 'Bio::Cells'];
    must(insertCard(db, { id:`card-${id}`, deckId:id, noteId:null, front:'Original <img src="diagram.png">', back:'Original answer', tags, createdAt:1, updatedAt:1 }));
    for (const tag of tags) { must(addTagToDeck(db, id, tag, 1)); must(upsertTagColor(db, tag, '#123456', 1)); }
    decks.set(id, db); originals.set(id, db.export());
  }
  let catalog: GlobalTag[] = [{ name:'Bio', color:'#123456' }, { name:'Bio::Cells', color:'#345678' }];
  let durableCatalog = JSON.stringify(catalog);
  const edits: EditFile[] = [];
  const writeEdit = vi.fn(async (deckId: string, ops: EditOp[]) => {
    const hlc = `1800000000000_device-a_${String(edits.length).padStart(4, '0')}`;
    edits.push({ v:1, hlc, deckId, deviceId:'device-a', ops });
    return hlc;
  });
  const saveCatalog = vi.fn(async (tags: GlobalTag[]) => { durableCatalog = JSON.stringify(tags); catalog = tags; });
  const openDeck = vi.fn(async (deckId: string) => decks.get(deckId) ?? null);
  const mutations = createGlobalTagMutations({ deckIds:() => [...decks.keys()], openDeck, writeEdit, getCatalog:() => catalog, saveCatalog });
  return { decks, originals, edits, writeEdit, saveCatalog, openDeck, mutations, catalog:() => catalog, durableCatalog:() => JSON.parse(durableCatalog) as GlobalTag[] };
}

describe('global tag durability and propagation', () => {
  it('persists rename/recolour/delete to every affected deck and replays the same result remotely', async () => {
    const test = fixture();
    await test.mutations.rename('Bio', 'Science');
    await test.mutations.upsert('Science', '#abcdef');
    await test.mutations.remove('Science');
    expect(test.durableCatalog()).toEqual([{ name:'Bio::Cells', color:'#345678' }]);
    expect(test.edits.every(edit => edit.deckId !== 'unrelated')).toBe(true);
    for (const id of ['deck-a', 'deck-b']) {
      const local = test.decks.get(id)!;
      expect(must(getCardsByDeck(local, id))[0]).toMatchObject({ tags:['Bio::Cells'], front:'Original <img src="diagram.png">', back:'Original answer' });
      expect(must(getTagsForDeck(local, id)).map(tag => tag.tag)).toEqual(['Bio::Cells']);
      const remote = new SQL.Database(test.originals.get(id)!); databases.push(remote);
      const edits = test.edits.filter(edit => edit.deckId === id);
      expect(replayEdits(remote, edits, new Set())).toBe(edits.at(-1)?.hlc);
      expect(must(getCardsByDeck(remote, id))).toEqual(must(getCardsByDeck(local, id)));
      expect(must(getTagsForDeck(remote, id))).toEqual(must(getTagsForDeck(local, id)));
      const restarted = new SQL.Database(local.export()); databases.push(restarted);
      expect(must(getCardsByDeck(restarted, id))[0]?.tags).toEqual(['Bio::Cells']);
    }
  });

  it('does not change any deck or catalogue when another deck cannot be opened', async () => {
    const test = fixture();
    test.openDeck.mockImplementation(async id => id === 'deck-b' ? null : test.decks.get(id)!);
    await expect(test.mutations.rename('Bio', 'Science')).rejects.toThrow('available');
    expect(test.writeEdit).not.toHaveBeenCalled(); expect(test.saveCatalog).not.toHaveBeenCalled();
    expect(must(getCardsByDeck(test.decks.get('deck-a')!, 'deck-a'))[0]?.tags[0]).toBe('Bio');
  });

  it('does not publish success after a partial durable failure and finishes an idempotent retry', async () => {
    const test = fixture();
    const write = test.writeEdit.getMockImplementation()!;
    let failed = false;
    test.writeEdit.mockImplementation(async (id, ops) => {
      if (id === 'deck-b' && !failed) { failed = true; throw new Error('Disk full'); }
      return write(id, ops);
    });
    await expect(test.mutations.rename('Bio', 'Science')).rejects.toThrow('Disk full');
    expect(test.catalog().some(tag => tag.name === 'Bio')).toBe(true);
    expect(must(getCardsByDeck(test.decks.get('deck-a')!, 'deck-a'))[0]?.tags[0]).toBe('Science');
    expect(must(getCardsByDeck(test.decks.get('deck-b')!, 'deck-b'))[0]?.tags[0]).toBe('Bio');
    await test.mutations.rename('Bio', 'Science');
    expect(test.durableCatalog().some(tag => tag.name === 'Science')).toBe(true);
    expect(test.edits.filter(edit => edit.deckId === 'deck-a')).toHaveLength(1);
    expect(must(getCardsByDeck(test.decks.get('deck-b')!, 'deck-b'))[0]?.tags[0]).toBe('Science');
  });

  it('keeps the catalogue unchanged when its final save fails and permits retry', async () => {
    const test = fixture();
    test.saveCatalog.mockRejectedValueOnce(new Error('Registry locked'));
    await expect(test.mutations.rename('Bio', 'Science')).rejects.toThrow('Registry locked');
    expect(test.durableCatalog().some(tag => tag.name === 'Bio')).toBe(true);
    await test.mutations.rename('Bio', 'Science');
    expect(test.catalog().some(tag => tag.name === 'Bio')).toBe(false);
    expect(test.durableCatalog().some(tag => tag.name === 'Science')).toBe(true);
  });

  it('serializes overlapping rename/recolour requests and preserves imported colour choices', async () => {
    const test = fixture();
    await Promise.all([test.mutations.rename('Bio', 'Science'), test.mutations.upsert('Science', '#abcdef')]);
    await test.mutations.mergeImported([{ tag:'Science', color:'#ff0000' }, { tag:'Bio::Cells::DNA', color:'#556677' }]);
    expect(test.durableCatalog().find(tag => tag.name === 'Science')?.color).toBe('#abcdef');
    for (const id of ['deck-a', 'deck-b']) expect(must(getTagsForDeck(test.decks.get(id)!, id)).find(tag => tag.tag === 'Science')?.color).toBe('#abcdef');
    expect(test.durableCatalog()).toContainEqual({ name:'Bio::Cells::DNA', color:'#556677' });
  });
});
