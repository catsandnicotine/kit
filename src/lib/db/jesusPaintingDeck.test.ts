import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import initSqlJs from 'sql.js';
import { describe, expect, it } from 'vitest';
import { jesusPaintingCatalogue } from '../../data/jesusPaintings';
import { JESUS_PAINTING_FILES } from '../../data/jesusPaintingFiles';
import { getMediaReferences, rewriteMediaUrls } from '../media';
import { getBundledPaintingFiles, getBundledPaintingUrl, JESUS_PAINTING_DECK_ID } from '../jesusPaintingAssets';
import { createJesusPaintingDeckSnapshot } from './jesusPaintingDeck';
import { ALL_TABLES } from './schema';
import { runMigrations } from './migrations';
import { insertCard, insertDeck, insertNote, insertNoteType } from './queries';
import { configureSqlJsPath, parseApkg } from '../apkg/parser';
import { exportDeckAsApkgFresh } from '../apkg/exporter';

describe('Jesus in Paintings', () => {
  it('exports and reimports every card with its actual painting bytes', async () => {
    const locateFile = (file: string) => path.join(process.cwd(), 'node_modules/sql.js/dist', file);
    configureSqlJsPath(locateFile);
    const SQL = await initSqlJs({ locateFile });
    const db = new SQL.Database();
    try {
      for (const ddl of ALL_TABLES) db.run(ddl);
      runMigrations(db);
      const snapshot = createJesusPaintingDeckSnapshot(jesusPaintingCatalogue, 1234);
      expect(insertDeck(db, snapshot.deck).success).toBe(true);
      for (const noteType of snapshot.noteTypes) expect(insertNoteType(db, noteType).success).toBe(true);
      for (const note of snapshot.notes) expect(insertNote(db, note).success).toBe(true);
      for (const card of snapshot.cards) expect(insertCard(db, card).success).toBe(true);
      const exported = await exportDeckAsApkgFresh(db, snapshot.deckId, async () => JESUS_PAINTING_FILES.map(filename => ({
        filename, data: new Uint8Array(fs.readFileSync(`public/decks/jesus-paintings/${filename}`)), mimeType: 'image/jpeg',
      })));
      if (!exported.success) throw new Error(exported.error);
      const bytes = new Uint8Array(await exported.data.arrayBuffer());
      const parsed = await parseApkg(bytes.buffer as ArrayBuffer);
      if (!parsed.success) throw new Error(parsed.error);
      expect(parsed.data.cards).toHaveLength(snapshot.cards.length);
      expect(parsed.data.media).toHaveLength(JESUS_PAINTING_FILES.length);
      expect(new Set(parsed.data.media.map(media => media.filename))).toEqual(new Set(JESUS_PAINTING_FILES));
      expect(parsed.data.notes.every(note => note.fields[1]?.includes('Museum record'))).toBe(true);
      if (process.env.KIT_ART_EXPORT_PATH) fs.writeFileSync(process.env.KIT_ART_EXPORT_PATH, bytes);
    } finally { db.close(); }
  }, 30000);

  it('ships a source and licensed offline image for every study card', () => {
    const snapshot = createJesusPaintingDeckSnapshot(jesusPaintingCatalogue, 1234);
    expect(snapshot.cards.length).toBeGreaterThan(100);
    expect(snapshot.cards.length).toBe(jesusPaintingCatalogue.paintings.length);
    expect(snapshot.cards.length).toBe(JESUS_PAINTING_FILES.length);
    expect(new Set(snapshot.cards.map(card => card.id)).size).toBe(snapshot.cards.length);
    expect(snapshot.cardStates).toEqual([]);
    expect(snapshot.reviewLogs).toEqual([]);
    const checksums: Record<string, string> = JSON.parse(fs.readFileSync('public/decks/jesus-paintings/checksums.json', 'utf8'));
    for (const [index, art] of jesusPaintingCatalogue.paintings.entries()) {
      expect(art.rights).toBe('CC0');
      expect(art.rightsEvidence).toBeTruthy();
      expect(art.sourceUrl).toMatch(/^https:\/\//);
      expect(art.metadataUrl).toMatch(/^https:\/\//);
      const card = snapshot.cards[index]!;
      const filename = `jesus-${art.id}.jpg`;
      const bytes = fs.readFileSync(`public/decks/jesus-paintings/${filename}`);
      expect(bytes.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(checksums[filename]);
      expect(getMediaReferences(card.front)).toEqual(new Set([filename]));
      const url = getBundledPaintingUrl(snapshot.deckId, filename)!;
      expect(rewriteMediaUrls(card.front, new Map([[filename, url]]))).toContain(`src="${url}"`);
      expect(card.back).toContain('Museum record');
      expect(card.front).not.toContain(art.title);
    }
  });

  it('keeps artwork IDs stable and explicitly marks unknown origin', () => {
    expect(jesusPaintingCatalogue.paintings.find(art => art.id === 'cma-97139')?.artist).toMatch(/circle of Leonardo/i);
    expect(jesusPaintingCatalogue.paintings.find(art => art.id === 'cma-124050')?.artist).toMatch(/possibly by Icilio/i);
    const art = jesusPaintingCatalogue.paintings[0]!;
    const catalogue = { ...jesusPaintingCatalogue, paintings: [{ ...art, origin: '', artist: '<script>bad</script>', title: 'A & B' }] };
    const first = createJesusPaintingDeckSnapshot(catalogue, 1);
    const second = createJesusPaintingDeckSnapshot(catalogue, 2);
    expect(first.cards[0]!.id).toBe(second.cards[0]!.id);
    expect(first.cards[0]!.back).toContain('Not specified in museum record');
    expect(first.cards[0]!.back).toContain('&lt;script&gt;');
    expect(first.cards[0]!.back).not.toContain('<script>');
    expect(first.cards[0]!.back).toContain('A &amp; B');
    expect(() => createJesusPaintingDeckSnapshot({ ...catalogue, paintings: [art, art] })).toThrow('duplicate');
  });

  it('limits built-in media fallback to this deck and known filenames', () => {
    expect(getBundledPaintingFiles(JESUS_PAINTING_DECK_ID)).toEqual(JESUS_PAINTING_FILES);
    expect(getBundledPaintingFiles('other-deck')).toEqual([]);
    expect(getBundledPaintingUrl('other-deck', JESUS_PAINTING_FILES[0]!)).toBeUndefined();
    expect(getBundledPaintingUrl(JESUS_PAINTING_DECK_ID, '../privacy.html')).toBeUndefined();
    expect(getBundledPaintingUrl(JESUS_PAINTING_DECK_ID, 'jesus-met-9999999999.jpg')).toBeUndefined();
  });
});
