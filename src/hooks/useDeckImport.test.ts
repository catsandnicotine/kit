import type { Database } from 'sql.js';
import { describe, expect, it, vi } from 'vitest';
import { createEmptyDeckSnapshot } from '../lib/db/deckFactory';
import { createImportedSnapshots } from './useDeckImport';

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
