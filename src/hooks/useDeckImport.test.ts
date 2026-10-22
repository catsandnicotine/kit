import path from 'node:path';
import JSZip from 'jszip';
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createEmptyDeckSnapshot } from '../lib/db/deckFactory';
import { buildSnapshotFromTempDb, createImportedSnapshots, storeEntities } from './useDeckImport';
import { ALL_TABLES, ENABLE_FOREIGN_KEYS } from '../lib/db/schema';
import { closeDeck, createDeckFromSnapshot, initDeckManager, openDeck } from '../lib/db/deckManager';
import { getAllDecks, getCardsByDeck, getCardStatesByDeck, getNotesByDeck, getNoteTypesByDeck, getReviewLogsByDeck } from '../lib/db/queries';
import { configureSqlJsPath, extractMediaBatch, parseApkgLazy } from '../lib/apkg/parser';
import { renderTemplate } from '../lib/apkg/templateRenderer';
import { getMediaReferences } from '../lib/media';
import type { CardState, Result, ReviewLog } from '../types';
import type { SyncStorage } from '../lib/sync/syncStorage';

let SQL: SqlJsStatic;
beforeAll(async () => {
  const locateFile = (file: string) => path.join(process.cwd(), 'node_modules/sql.js/dist', file);
  configureSqlJsPath(locateFile);
  SQL = await initSqlJs({ locateFile });
});

function must<T>(result: Result<T>): T {
  if (!result.success) throw new Error(result.error);
  return result.data;
}

async function multiDeckPackage(): Promise<ArrayBuffer> {
  const source = new SQL.Database();
  try {
    const model = {
      id: 1000, name: 'Shared Basic', css: '.card { color: #426550; }',
      flds: [{ name: 'Front', ord: 0 }, { name: 'Back', ord: 1 }],
      tmpls: [
        { name: 'Forward', ord: 0, qfmt: '{{Front}}', afmt: '{{FrontSide}}<hr>{{Back}}' },
        { name: 'Reverse', ord: 1, qfmt: '{{Back}}', afmt: '{{FrontSide}}<hr>{{Front}}' },
      ],
    };
    source.run('CREATE TABLE col (models TEXT, decks TEXT)');
    source.run('INSERT INTO col VALUES (?, ?)', [JSON.stringify({ 1000: model }), JSON.stringify({
      2: { id: 2, name: 'Art & symbols', desc: 'Original symbols' },
      3: { id: 3, name: 'Italian', desc: 'Useful words' },
      4: { id: 4, name: 'Biology', desc: 'Cell structure' },
    })]);
    source.run('CREATE TABLE notes (id INTEGER, mid INTEGER, tags TEXT, flds TEXT)');
    for (const [id, front, back] of [
      [100_000, 'What does the eye reveal?', 'The answer'],
      [200_000, 'Good morning', 'Buongiorno'],
      [300_000, 'What surrounds a cell?<img src="cell.png">', 'Cell membrane'],
    ] as const) source.run('INSERT INTO notes VALUES (?, ?, ?, ?)', [id, 1000, ' tutorial ', `${front}\x1f${back}`]);
    source.run('CREATE TABLE cards (id INTEGER, nid INTEGER, did INTEGER, ord INTEGER, type INTEGER, due INTEGER, ivl INTEGER, factor INTEGER, reps INTEGER, lapses INTEGER)');
    for (const [id, note, deck, ord] of [[1, 100_000, 2, 0], [2, 200_000, 3, 0], [3, 300_000, 4, 0], [4, 300_000, 3, 1]]) {
      source.run('INSERT INTO cards VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [id!, note!, deck!, ord!, 0, 0, 0, 2500, 0, 0]);
    }
    const zip = new JSZip();
    zip.file('collection.anki2', source.export());
    zip.file('media', JSON.stringify({ 0: 'cell.png' }));
    zip.file('0', new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
    return await zip.generateAsync({ type: 'arraybuffer' });
  } finally { source.close(); }
}

function memorySyncStorage(files: Map<string, string>): SyncStorage {
  return {
    writeFile: async (name, value) => { files.set(name, value); },
    readFile: async name => files.get(name) ?? null,
    deleteFile: async name => { files.delete(name); },
    listDirectory: async () => [],
    fileExists: async name => files.has(name),
    copyFileToSync: async () => {}, copyFileFromSync: async () => {},
    queuePendingEdit: async () => {}, listPendingEdits: async () => [], removePendingEdit: async () => {},
    isAvailable: async () => true,
  };
}


describe('createImportedSnapshots', () => {
  it('reports a null snapshot creation result and exposes staged IDs for rollback', async () => {
    const first = createEmptyDeckSnapshot('First', 'first', 1);
    const second = createEmptyDeckSnapshot('Second', 'second', 1);
    const create = vi.fn<(snapshot: typeof first) => Promise<Database | null>>()
      .mockResolvedValueOnce({} as Database)
      .mockResolvedValueOnce(null);
    const stagedDeckIds: string[] = [];

    await expect(createImportedSnapshots(
      [first, second],
      create,
      deckId => stagedDeckIds.push(deckId),
    )).rejects.toThrow('Could not save imported deck "Second" to this device.');

    expect(create).toHaveBeenCalledTimes(2);
    expect(stagedDeckIds).toEqual(['first']);
  });
});


describe('multi-deck Anki import snapshots', () => {
  it('restores every deck independently with shared notes, models, templates, media references, and Kit progress', async () => {
    const sourceBytes = await multiDeckPackage();
    const untouchedBytes = sourceBytes.slice(0);
    const parsed = must(await parseApkgLazy(sourceBytes));
    const statesByContent: Record<string, CardState> = {};
    const logsByContent: Record<string, ReviewLog[]> = {};
    const expectedContent = new Map<string, string[]>();
    for (const [index, card] of parsed.cards.entries()) {
      const note = parsed.notes.find(item => item.id === card.noteId)!;
      const model = parsed.noteTypes.find(item => item.id === note.noteTypeId)!;
      const rendered = must(renderTemplate(note, model, card.templateOrd));
      const key = `${rendered.front}\x1f${rendered.back}`;
      const name = parsed.decks.find(deck => deck.id === card.deckId)!.name;
      expectedContent.set(name, [...(expectedContent.get(name) ?? []), key]);
      statesByContent[key] = { cardId: 'source-card', due: 2_000_000_000 + index, stability: 31.25, difficulty: 5.25, elapsedDays: 4, scheduledDays: 10, reps: 12, lapses: 2, state: 'review', lastReview: 1_900_000_000, learningStepIndex: 0, suspended: true };
      logsByContent[key] = [{ id: 'source-log', cardId: 'source-card', rating: 'hard', reviewedAt: 1_900_000_000, elapsed: 4, scheduledDays: 10 }];
    }

    const work = new SQL.Database();
    const files = new Map<string, string>();
    initDeckManager({ SQL, storage: memorySyncStorage(files), registryJson: null });
    const created: string[] = [];
    try {
      work.run(ENABLE_FOREIGN_KEYS);
      for (const ddl of ALL_TABLES) work.run(ddl);
      must(storeEntities(work, parsed, { version: 1, statesByContent, logsByContent }));
      const snapshots = must(getAllDecks(work)).map(deck => buildSnapshotFromTempDb(work, deck.id)!);
      expect(snapshots).toHaveLength(3);
      expect(snapshots.every(Boolean)).toBe(true);
      await createImportedSnapshots(snapshots, createDeckFromSnapshot, id => created.push(id));
      expect(created).toHaveLength(3);

      for (const snapshot of snapshots) {
        // Exercise the persisted snapshot path, not just the newly created cache.
        closeDeck(snapshot.deckId);
        const restored = await openDeck(snapshot.deckId);
        expect(restored).not.toBeNull();
        if (!restored) throw new Error(`Could not restore ${snapshot.deck.name}`);
        expect(restored.exec('PRAGMA foreign_key_check')).toEqual([]);
        const cards = must(getCardsByDeck(restored, snapshot.deckId));
        const notes = must(getNotesByDeck(restored, snapshot.deckId));
        const models = must(getNoteTypesByDeck(restored, snapshot.deckId));
        expect(cards.map(card => `${card.front}\x1f${card.back}`).sort()).toEqual(expectedContent.get(snapshot.deck.name)!.sort());
        expect(notes.every(note => note.deckId === snapshot.deckId)).toBe(true);
        expect(models.every(model => model.deckId === snapshot.deckId)).toBe(true);
        expect(models).toHaveLength(1);
        expect(models[0]?.templates.map(template => template.name)).toEqual(['Forward', 'Reverse']);
        expect(models[0]?.css).toContain('#426550');
        expect(new Set(notes.map(note => note.id)).size).toBe(notes.length);
        for (const card of cards) {
          expect(notes.some(note => note.id === card.noteId)).toBe(true);
          const key = `${card.front}\x1f${card.back}`;
          expect(must(getCardStatesByDeck(restored, snapshot.deckId)).find(state => state.cardId === card.id)).toEqual({ ...statesByContent[key], cardId: card.id });
          expect(must(getReviewLogsByDeck(restored, snapshot.deckId)).find(log => log.cardId === card.id)).toMatchObject({ ...logsByContent[key]![0], id: expect.any(String), cardId: card.id });
        }
        if (snapshot.deck.name !== 'Art & symbols') {
          expect(getMediaReferences(cards.map(card => card.front + card.back).join(''))).toContain('cell.png');
        }
      }
      const italian = snapshots.find(snapshot => snapshot.deck.name === 'Italian')!;
      const biology = snapshots.find(snapshot => snapshot.deck.name === 'Biology')!;
      const italianShared = italian.notes.find(note => note.fields.Back === 'Cell membrane')!;
      expect(biology.notes[0]?.id).toBe(italianShared.id);
      expect(biology.noteTypes[0]?.id).toBe(italian.noteTypes[0]?.id);
      const media = await extractMediaBatch(parsed.zip, parsed.mediaManifest, 0, 50, parsed.mediaIsCompressed);
      expect(media[0]).toMatchObject({ filename: 'cell.png', data: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]) });
      expect(new Uint8Array(sourceBytes)).toEqual(new Uint8Array(untouchedBytes));
    } finally {
      for (const id of created) closeDeck(id);
      work.close();
    }
  });
});
