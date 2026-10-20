import path from 'path';
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import { beforeAll, describe, expect, it } from 'vitest';
import type { DeckSnapshot } from '../sync/types';
import type { SyncStorage } from '../sync/syncStorage';
import {
  closeDeck,
  createDeckFromSnapshot,
  initDeckManager,
} from './deckManager';
import { getAllDeckEntries } from '../sync/deckRegistry';

const WASM_DIR = path.join(process.cwd(), 'node_modules/sql.js/dist');

let SQL: SqlJsStatic;

beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: file => path.join(WASM_DIR, file) });
});

function storageWithWrite(writeFile: SyncStorage['writeFile']): SyncStorage {
  return {
    writeFile,
    readFile: async () => null,
    deleteFile: async () => {},
    listDirectory: async () => [],
    fileExists: async () => false,
    copyFileToSync: async () => {},
    copyFileFromSync: async () => {},
    queuePendingEdit: async () => {},
    listPendingEdits: async () => [],
    removePendingEdit: async () => {},
    isAvailable: async () => true,
  };
}

function emptySnapshot(deckId: string): DeckSnapshot {
  return {
    v: 1,
    deckId,
    compactedThrough: '',
    mergedEditFiles: [],
    deck: {
      id: deckId,
      name: `Deck ${deckId}`,
      description: '',
      createdAt: 1,
      updatedAt: 1,
    },
    settings: {
      deckId,
      newCardsPerDay: 20,
      maxReviewsPerDay: 200,
      againSteps: [1, 10],
      graduatingInterval: 1,
      easyInterval: 4,
      maxInterval: 365,
      leechThreshold: 8,
      desiredRetention: 0.9,
    },
    noteTypes: [],
    notes: [],
    cards: [],
    cardStates: [],
    reviewLogs: [],
    tags: [],
    deckTags: [],
    deletedCardIds: [],
  };
}

describe('createDeckFromSnapshot durability', () => {
  it('returns null and does not register a deck when the required local write fails', async () => {
    let syncWriteAttempted = false;
    initDeckManager({
      SQL,
      storage: storageWithWrite(async () => {
        syncWriteAttempted = true;
      }),
      registryJson: null,
      writeLocalSnapshot: async () => {
        throw new Error('disk full');
      },
    });

    const created = await createDeckFromSnapshot(emptySnapshot('local-failure'));

    expect(created).toBeNull();
    expect(syncWriteAttempted).toBe(false);
    expect(getAllDeckEntries()).toEqual([]);
  });

  it('succeeds offline after the required local snapshot commits', async () => {
    const localSnapshots = new Map<string, string>();
    initDeckManager({
      SQL,
      storage: storageWithWrite(async () => {
        throw new Error('iCloud unavailable');
      }),
      registryJson: null,
      writeLocalSnapshot: async (deckId, data) => {
        localSnapshots.set(deckId, data);
      },
    });

    const created = await createDeckFromSnapshot(emptySnapshot('offline-deck'));

    expect(created).not.toBeNull();
    expect(localSnapshots.has('offline-deck')).toBe(true);
    expect(getAllDeckEntries().map(entry => entry.deckId)).toEqual(['offline-deck']);
    closeDeck('offline-deck');
  });

  it('returns null when sync storage is the only backend and its write fails', async () => {
    initDeckManager({
      SQL,
      storage: storageWithWrite(async () => {
        throw new Error('storage unavailable');
      }),
      registryJson: null,
    });

    const created = await createDeckFromSnapshot(emptySnapshot('sync-failure'));

    expect(created).toBeNull();
    expect(getAllDeckEntries()).toEqual([]);
  });
});
