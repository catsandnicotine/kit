import type { Database } from 'sql.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UseDeckManagerReturn } from './useDeckManager';

const mock = vi.hoisted(() => ({
  states:[] as unknown[][],
  exportFresh:vi.fn(), exportProgress:vi.fn(), listMedia:vi.fn(), loadMedia:vi.fn(), legacyMedia:vi.fn(),
}));
vi.mock('react', () => ({
  useState:(initial: unknown) => { const updates: unknown[] = []; mock.states.push(updates); return [initial, (value: unknown) => updates.push(value)]; },
  useCallback:(callback: unknown) => callback,
}));
vi.mock('../lib/apkg/exporter', () => ({ exportDeckAsApkgFresh:mock.exportFresh, exportDeckAsApkgWithProgress:mock.exportProgress }));
vi.mock('../lib/platform/mediaFiles', () => ({ listMediaFilenames:mock.listMedia, loadMediaFile:mock.loadMedia }));
vi.mock('../lib/db/queries', () => ({ getMediaByDeck:mock.legacyMedia }));
vi.mock('../lib/jesusPaintingAssets', () => ({ getBundledPaintingFiles:() => [], getBundledPaintingUrl:() => null }));

import { useExport } from './useExport';

beforeEach(() => {
  mock.states.length = 0;
  for (const callback of [mock.exportFresh, mock.exportProgress, mock.listMedia, mock.loadMedia, mock.legacyMedia]) callback.mockReset();
  mock.listMedia.mockResolvedValue([]);
  mock.legacyMedia.mockReturnValue({ success:true, data:[] });
});

describe('export failure recovery', () => {
  it('reports a rejected deck open and leaves exporting instead of rejecting outside its guard', async () => {
    const source = { getCachedDeckDb:() => null, openDeckDb:async () => { throw new Error('snapshot unreadable'); } } as unknown as UseDeckManagerReturn;
    const exporter = useExport(source);
    await expect(exporter.exportDeckFresh('deck', 'Deck')).resolves.toBeUndefined();
    expect(mock.states[0]).toEqual(['exporting', 'error']);
    expect(mock.states[1]).toEqual(['', 'Export failed: Error: snapshot unreadable']);
    expect(mock.exportFresh).not.toHaveBeenCalled();
  });

  it('refuses a known attachment that cannot be read instead of silently exporting without it', async () => {
    mock.listMedia.mockResolvedValue(['photo.png']);
    mock.loadMedia.mockResolvedValue(null);
    mock.exportProgress.mockImplementation(async (_db: Database, id: string, load: (deckId: string) => Promise<unknown>) => {
      await load(id);
      throw new Error('Should not omit the unreadable attachment');
    });
    const exporter = useExport({} as Database);
    await expect(exporter.exportDeckWithProgress('deck', 'Deck')).resolves.toBeUndefined();
    expect(mock.states[0]).toEqual(['exporting', 'error']);
    expect(mock.states[1]?.[1]).toEqual(expect.stringContaining('An attachment could not be read'));
    expect(mock.legacyMedia).not.toHaveBeenCalled();
  });

  it('reports failed legacy media reads instead of treating their contents as an empty list', async () => {
    mock.legacyMedia.mockReturnValue({ success:false, error:'media table unreadable' });
    mock.exportFresh.mockImplementation(async (_db: Database, id: string, load: (deckId: string) => Promise<unknown>) => {
      await load(id);
      throw new Error('Should not export without reading the legacy attachments');
    });
    const exporter = useExport({} as Database);
    await exporter.exportDeckFresh('deck', 'Deck');
    expect(mock.states[0]).toEqual(['exporting', 'error']);
    expect(mock.states[1]?.[1]).toEqual(expect.stringContaining('media table unreadable'));
  });
});
