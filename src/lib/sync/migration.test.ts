import path from 'path';
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALL_TABLES, ENABLE_FOREIGN_KEYS } from '../db';
import { runMigrations } from '../db/migrations';
import { insertDeck } from '../db/queries';
import { getAllDeckEntries, initRegistry } from './deckRegistry';
import { migrateMonolithicDb } from './migration';
import type { SyncStorage } from './syncStorage';

const WASM_DIR = path.join(process.cwd(), 'node_modules/sql.js/dist');

let SQL: SqlJsStatic;

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
