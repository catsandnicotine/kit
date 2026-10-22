import path from 'path';
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALL_TABLES, ENABLE_FOREIGN_KEYS } from '../db';
import { runMigrations } from '../db/migrations';
import { getCardsByDeck, getCardStatesByDeck, getReviewLogsByDeck, insertCard, insertDeck, insertReviewLog, setCardState } from '../db/queries';
import { closeDeck, initDeckManager, openDeck } from '../db/deckManager';
import { getAllDeckEntries, initRegistry, serializeRegistry } from './deckRegistry';
import { migrateMonolithicDb } from './migration';
import type { SyncStorage } from './syncStorage';
import type { Card, CardState, ReviewLog } from '../../types';

const WASM_DIR = path.join(process.cwd(), 'node_modules/sql.js/dist');

let SQL: SqlJsStatic;

const savedCard: Card = {
  id: 'existing-reviewed-card', deckId: 'deck-a', noteId: null,
  front: '<p>Existing question</p><img src="original-diagram.png">',
  back: '<p>Edited answer</p>[sound:original-audio.mp3]',
  tags: ['biology'], createdAt: 10, updatedAt: 30,
};
const savedState: CardState = {
  cardId: savedCard.id, due: 2_000_000_000, stability: 44.25, difficulty: 5.75,
  elapsedDays: 12, scheduledDays: 45, reps: 22, lapses: 2, state: 'review',
  lastReview: 1_999_000_000, learningStepIndex: 0, suspended: true,
};
const savedLog: ReviewLog = {
  id: 'existing-review-log', cardId: savedCard.id, rating: 'hard',
  reviewedAt: 1_999_000_000, elapsed: 12, scheduledDays: 45,
};

beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: file => path.join(WASM_DIR, file) });
});

beforeEach(() => {
  initRegistry(null);
});

function legacyDatabaseBytes(): Uint8Array {
  const db = new SQL.Database();
  db.run(ENABLE_FOREIGN_KEYS);
  for (const ddl of ALL_TABLES) db.run(ddl);
  runMigrations(db);

  const first = insertDeck(db, {
    id: 'deck-a',
    name: 'Alpha',
    description: '',
    createdAt: 1,
    updatedAt: 1,
  });
  const second = insertDeck(db, {
    id: 'deck-b',
    name: 'Beta',
    description: '',
    createdAt: 2,
    updatedAt: 2,
  });
  if (!first.success || !second.success) throw new Error('Could not build migration fixture.');
  for (const result of [insertCard(db, savedCard), setCardState(db, savedState), insertReviewLog(db, savedLog)]) {
    if (!result.success) throw new Error(result.error);
  }

  const bytes = db.export();
  db.close();
  return bytes;
}

function storageWithWrite(
  writeFile: SyncStorage['writeFile'],
  deleteFile: SyncStorage['deleteFile'] = async () => {},
): SyncStorage {
  return {
    writeFile,
    readFile: async () => null,
    deleteFile,
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

describe('migrateMonolithicDb durability', () => {
  it('preserves existing card edits, media references, scheduling and history after migration and reopening offline', async () => {
    const original = legacyDatabaseBytes();
    const originalCopy = original.slice();
    const snapshots = new Map<string, string>();
    const storage = storageWithWrite(async () => { throw new Error('offline'); });
    await migrateMonolithicDb(SQL, original, storage, 'device-12345678', async (deckId, data) => {
      snapshots.set(deckId, data);
    });

    initDeckManager({
      SQL, storage, registryJson: serializeRegistry(),
      readLocalSnapshot: async deckId => snapshots.get(deckId) ?? null,
    });
    try {
      const reopened = await openDeck('deck-a');
      expect(reopened).not.toBeNull();
      if (!reopened) throw new Error('Existing deck failed to reopen.');
      expect(getCardsByDeck(reopened, 'deck-a')).toEqual({ success: true, data: [savedCard] });
      expect(getCardStatesByDeck(reopened, 'deck-a')).toEqual({ success: true, data: [savedState] });
      expect(getReviewLogsByDeck(reopened, 'deck-a')).toEqual({ success: true, data: [savedLog] });
      expect(original).toEqual(originalCopy);
      expect(getAllDeckEntries().find(entry => entry.deckId === 'deck-a')?.cardCount).toBe(1);
    } finally {
      closeDeck('deck-a');
    }
  });

  it('completes offline when every deck has a durable local snapshot', async () => {
    const localSnapshots = new Map<string, string>();
    const syncWrite = vi.fn(async () => {
      throw new Error('iCloud unavailable');
    });

    const migrated = await migrateMonolithicDb(
      SQL,
      legacyDatabaseBytes(),
      storageWithWrite(syncWrite),
      'device-12345678',
      async (deckId, data) => {
        localSnapshots.set(deckId, data);
      },
    );

    expect(migrated).toBe(2);
    expect(localSnapshots.size).toBe(2);
    expect(getAllDeckEntries().map(entry => entry.deckId)).toEqual(['deck-a', 'deck-b']);
  });

  it('does not expose a partial registry when a required local write fails', async () => {
    const storage = storageWithWrite(async () => {});
    const deletedLocalDeckIds: string[] = [];

    await expect(migrateMonolithicDb(
      SQL,
      legacyDatabaseBytes(),
      storage,
      'device-12345678',
      async deckId => {
        if (deckId === 'deck-b') throw new Error('disk full');
      },
      async deckId => {
        deletedLocalDeckIds.push(deckId);
      },
    )).rejects.toThrow('disk full');

    expect(getAllDeckEntries()).toEqual([]);
    expect(deletedLocalDeckIds).toEqual(['deck-a']);
  });

  it('requires sync storage and removes partial sync writes when no local writer is configured', async () => {
    const syncedPaths = new Set<string>();
    const storage = storageWithWrite(
      async path => {
        if (path.startsWith('deck-b/')) throw new Error('storage unavailable');
        syncedPaths.add(path);
      },
      async path => {
        syncedPaths.delete(path);
      },
    );

    await expect(migrateMonolithicDb(
      SQL,
      legacyDatabaseBytes(),
      storage,
      'device-12345678',
    )).rejects.toThrow('Could not persist legacy deck');

    expect(getAllDeckEntries()).toEqual([]);
    expect(syncedPaths.size).toBe(0);
  });
});
