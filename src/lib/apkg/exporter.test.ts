import path from 'node:path';
import JSZip from 'jszip';
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Card, CardState, Result, ReviewLog } from '../../types';
import { ALL_TABLES, ENABLE_FOREIGN_KEYS } from '../db/schema';
import { runMigrations } from '../db/migrations';
import { getCardsByDeck, getCardStatesByDeck, getNotesByDeck, getReviewLogsByDeck, insertCard, insertDeck, insertMedia, insertNote, insertNoteType, insertReviewLog, setCardState, updateCard } from '../db/queries';
import { storeEntities } from '../../hooks/useDeckImport';
import { configureSqlJsPath, extractMediaBatch, parseApkg, parseApkgLazy } from './parser';
import { exportDeckAsApkgFresh, exportDeckAsApkgWithProgress } from './exporter';
import { parseKitProgress } from './kitProgress';

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

function emptyDb(): Database {
  const db = new SQL.Database();
  db.run(ENABLE_FOREIGN_KEYS);
  for (const ddl of ALL_TABLES) db.run(ddl);
  runMigrations(db);
  return db;
}

function fixture() {
  const db = emptyDb();
  must(insertDeck(db, { id:'deck', name:'Biology snapshot', description:'Edited cards', createdAt:1, updatedAt:2 }));
  must(insertNoteType(db, { id:'old-model', deckId:'deck', name:'Original two-way model', fields:['Prompt', 'Response'], templates:[
    { name:'Forward', ord:0, qfmt:'{{Prompt}}', afmt:'{{Response}}' },
    { name:'Reverse', ord:1, qfmt:'{{Response}}', afmt:'{{Prompt}}' },
  ], css:'.card {color: blue}', createdAt:1 }));
  must(insertNote(db, { id:'old-note', deckId:'deck', noteTypeId:'old-model', fields:{ Prompt:'Old prompt', Response:'Old response' }, tags:['outdated'], createdAt:1, updatedAt:1 }));
  const cards: Card[] = [
    { id:'edited', deckId:'deck', noteId:'old-note', front:'Old prompt', back:'Old response', tags:['outdated'], createdAt:1, updatedAt:1 },
    { id:'manual', deckId:'deck', noteId:null, front:'<p>Manual photo question</p><img src="cell &amp; membrane.png">', back:'<p>Audio explanation</p>[sound:voice.mp3]<video poster="cell &amp; membrane.png"><source src="clip.mp4"></video>', tags:['manual'], createdAt:2, updatedAt:2 },
    { id:'duplicate-a', deckId:'deck', noteId:null, front:'Identical front', back:'Identical back', tags:['first twin'], createdAt:3, updatedAt:3 },
    { id:'duplicate-b', deckId:'deck', noteId:null, front:'Identical front', back:'Identical back', tags:['second twin'], createdAt:4, updatedAt:4 },
  ];
  for (const card of cards) must(insertCard(db, card));
  cards[0] = must(updateCard(db, 'edited', '<style>@font-face{font-family:Kit;src:url("letter.woff2")}</style><p>Edited front</p><a href="relative-not-an-attachment.html">Reference</a>', '<p>Edited answer</p>', ['edited-tag', 'cell membranes'], 10));
  const states: CardState[] = cards.map((card, index) => ({
    cardId:card.id, due:Math.floor(Date.now() / 1000) + (index + 2) * 86400,
    stability:23.5 + index, difficulty:4.25 + index, elapsedDays:index + 1,
    scheduledDays:index + 2, reps:index + 9, lapses:index, state:index === 1 ? 'learning' : 'review',
    lastReview:1_900_000_000 + index, learningStepIndex:index === 1 ? 1 : 0, suspended:index === 3,
  }));
  const logs: ReviewLog[] = states.map((state, index) => ({ id:`log-${index}`, cardId:state.cardId, rating:index % 2 ? 'hard' : 'good', reviewedAt:state.lastReview!, elapsed:state.elapsedDays, scheduledDays:state.scheduledDays }));
  for (const state of states) must(setCardState(db, state));
  for (const log of logs) must(insertReviewLog(db, log));
  const media = [
    { filename:'cell & membrane.png', data:new Uint8Array([137, 80, 78, 71]), mimeType:'image/png' },
    { filename:'voice.mp3', data:new Uint8Array([73, 68, 51, 3]), mimeType:'audio/mpeg' },
    { filename:'clip.mp4', data:new Uint8Array([0, 0, 0, 24]), mimeType:'video/mp4' },
    { filename:'letter.woff2', data:new Uint8Array([119, 79, 70, 50]), mimeType:'font/woff2' },
  ];
  for (const [index, file] of media.entries()) must(insertMedia(db, { ...file, id:`media-${index}`, deckId:'deck', createdAt:1 }));
  return { db, cards, states, logs, media };
}

describe('rendered card package exports', () => {
  it('roundtrips edited/imported/manual faces, tags, duplicate histories, and image/audio/video/font bytes', async () => {
    const { db, cards, states, logs, media } = fixture();
    const restored = emptyDb();
    try {
      const originalBytes = db.export();
      const blob = must(await exportDeckAsApkgWithProgress(db, 'deck'));
      expect(db.export()).toEqual(originalBytes);
      const parsed = must(await parseApkgLazy(await blob.arrayBuffer()));
      expect(parsed.cards).toHaveLength(cards.length);
      expect(parsed.notes).toHaveLength(cards.length);
      expect(parsed.cards.every(card => card.templateOrd === 0)).toBe(true);
      const progressFile = parsed.zip.file('kit_progress.json');
      expect(progressFile).not.toBeNull();
      const progress = must(parseKitProgress(await progressFile!.async('string')));
      expect(progress.version).toBe(2);
      const deckId = must(storeEntities(restored, parsed, progress));
      const actualCards = must(getCardsByDeck(restored, deckId));
      expect(actualCards.map(card => ({ front:card.front, back:card.back, tags:card.tags }))).toEqual(cards.map(card => ({ front:card.front, back:card.back, tags:card.tags })));
      expect(must(getNotesByDeck(db, 'deck'))[0]?.fields.Prompt).toBe('Old prompt');
      const actualStates = must(getCardStatesByDeck(restored, deckId));
      const actualLogs = must(getReviewLogsByDeck(restored, deckId));
      for (const [index, card] of actualCards.entries()) {
        expect(actualStates.find(state => state.cardId === card.id)).toEqual({ ...states[index], cardId:card.id });
        expect(actualLogs.filter(log => log.cardId === card.id)).toEqual([{ ...logs[index], id:expect.any(String), cardId:card.id }]);
      }
      const extracted = await extractMediaBatch(parsed.zip, parsed.mediaManifest, 0, 50, parsed.mediaIsCompressed);
      expect(extracted).toEqual(media);
      expect(restored.exec('PRAGMA foreign_key_check')).toEqual([]);
      expect(Object.keys(parsed.zip.files).some(name => name.includes('seen'))).toBe(false);

      const bytes = await parsed.zip.file('collection.anki2')!.async('uint8array');
      const anki = new SQL.Database(bytes);
      try {
        const queues = anki.exec('SELECT queue, due FROM cards ORDER BY id')[0]!.values;
        expect(queues[0]?.[1]).toBeGreaterThanOrEqual(1);
        expect(queues[0]?.[1]).toBeLessThanOrEqual(2);
        expect(queues[3]?.[0]).toBe(-1);
      } finally { anki.close(); }
    } finally { db.close(); restored.close(); }
  });

  it('fresh sharing contains the same cards and media but no scheduling, history or seen sidecar', async () => {
    const { db, cards, media } = fixture();
    const restored = emptyDb();
    try {
      const parsed = must(await parseApkgLazy(await must(await exportDeckAsApkgFresh(db, 'deck')).arrayBuffer()));
      expect(parsed.zip.file('kit_progress.json')).toBeNull();
      expect(Object.keys(parsed.zip.files).some(name => name.includes('seen'))).toBe(false);
      const metadata = JSON.parse(await parsed.zip.file('kit_cards.json')!.async('string')) as { cardsById:Record<string, unknown> };
      expect(Object.values(metadata.cardsById).every(card => typeof card === 'object' && card !== null && Object.keys(card).join() === 'tags')).toBe(true);
      expect(parsed.cards.every(card => card.type === 0 && card.reps === 0 && card.lapses === 0 && card.interval === 0)).toBe(true);
      const deckId = must(storeEntities(restored, parsed));
      expect(must(getCardsByDeck(restored, deckId)).map(card => ({ front:card.front, back:card.back, tags:card.tags }))).toEqual(cards.map(card => ({ front:card.front, back:card.back, tags:card.tags })));
      expect(must(getCardStatesByDeck(restored, deckId))).toEqual([]);
      expect(must(getReviewLogsByDeck(restored, deckId))).toEqual([]);
      expect(await extractMediaBatch(parsed.zip, parsed.mediaManifest, 0, 50)).toEqual(media);
    } finally { db.close(); restored.close(); }
  });

  it('refuses an incomplete media export instead of silently making a broken snapshot', async () => {
    const { db, media } = fixture();
    try {
      const result = await exportDeckAsApkgWithProgress(db, 'deck', async () => media.filter(file => file.filename !== 'voice.mp3'));
      expect(result).toEqual({ success:false, error:expect.stringContaining('not available on this device') });
      expect(must(getCardsByDeck(db, 'deck'))).toHaveLength(4);
      expect(must(getReviewLogsByDeck(db, 'deck'))).toHaveLength(4);
    } finally { db.close(); }
  });

  it('rolls back an imported v2 file whose saved per-card history is incomplete', async () => {
    const { db } = fixture();
    const restored = emptyDb();
    try {
      const parsed = must(await parseApkgLazy(await must(await exportDeckAsApkgWithProgress(db, 'deck')).arrayBuffer()));
      const progress = must(parseKitProgress(await parsed.zip.file('kit_progress.json')!.async('string')));
      if (progress.version !== 2) throw new Error('Expected v2 fixture');
      delete progress.cardsById[parsed.cards[1]!.id];
      expect(storeEntities(restored, parsed, progress)).toEqual({ success:false, error:expect.stringContaining('could not be read') });
      expect(restored.exec('SELECT count(*) FROM decks')[0]?.values[0]?.[0]).toBe(0);
      expect(restored.exec('SELECT count(*) FROM cards')[0]?.values[0]?.[0]).toBe(0);
      expect(restored.exec('SELECT count(*) FROM review_logs')[0]?.values[0]?.[0]).toBe(0);
    } finally { db.close(); restored.close(); }
  });

  it('keeps valid archive structure for one manual text-only card', async () => {
    const db = emptyDb();
    try {
      must(insertDeck(db, { id:'manual-deck', name:'Manual', description:'', createdAt:1, updatedAt:1 }));
      must(insertCard(db, { id:'manual-card', deckId:'manual-deck', noteId:null, front:'Question', back:'Answer', tags:[], createdAt:1, updatedAt:1 }));
      const blob = must(await exportDeckAsApkgFresh(db, 'manual-deck'));
      const zip = await JSZip.loadAsync(await blob.arrayBuffer());
      expect(zip.file('collection.anki2')).not.toBeNull();
      expect(await zip.file('media')!.async('string')).toBe('{}');
      const parsed = must(await parseApkgLazy(await blob.arrayBuffer()));
      expect(parsed.cards).toHaveLength(1);
      expect(parsed.notes[0]?.fields).toEqual(['Question', 'Answer']);
    } finally { db.close(); }
  });

  it.each(['malformed', 'missing-card'])('rejects %s content metadata in the parser before importing a partial deck', async kind => {
    const { db } = fixture();
    try {
      const zip = await JSZip.loadAsync(await must(await exportDeckAsApkgFresh(db, 'deck')).arrayBuffer());
      zip.file('kit_cards.json', kind === 'malformed' ? '{bad' : JSON.stringify({ version:1, cardsById:{} }));
      const bytes = await zip.generateAsync({ type:'arraybuffer' });
      expect(await parseApkgLazy(bytes)).toEqual({ success:false, error:expect.stringContaining('Kit card details') });
      expect(await parseApkg(bytes)).toEqual({ success:false, error:expect.stringContaining('Kit card details') });
      expect(must(getCardsByDeck(db, 'deck'))).toHaveLength(4);
    } finally { db.close(); }
  });
});
