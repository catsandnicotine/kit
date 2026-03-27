/**
 * useDeckManager — React hook for the per-deck sync architecture.
 *
 * Replaces useDatabase() as the primary database initialization hook.
 * Instead of loading one monolithic DB, it:
 *   1. Initializes sql.js WASM + the DeckManager.
 *   2. Discovers decks from iCloud + local registry.
 *   3. Opens per-deck databases on demand.
 *   4. Provides writeEdit() for sync-aware writes.
 *   5. Compacts after study sessions.
 *
 * The hook exposes a compatible interface so pages can receive per-deck
 * Database instances that work with the unchanged queries.ts functions.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Database } from 'sql.js';
import initSqlJs from 'sql.js';
import { configureSqlJsPath, configureWasmBinary } from '../lib/apkg';
import {
  initDeckManager,
  discoverDecks,
  openDeck,
  closeDeck,
  getDeckDb,
  applyAndSync,
  compactDeckEdits,
  getRegistryJson,
  createDeckFromSnapshot,
  syncDeck,
  refreshDeckCounts,
} from '../lib/db/deckManager';
import { createICloudSyncStorage } from '../lib/platform/icloudSync';
import { createBrowserSyncStorage } from '../lib/platform/browserSync';
import { loadDatabaseSnapshot } from '../lib/platform/persistence';
import { Filesystem, Directory } from '@capacitor/filesystem';
import type { DeckRegistryEntry, EditOp } from '../lib/sync/types';
import { needsMigration, migrateMonolithicDb } from '../lib/sync/migration';
import { getDeviceId } from '../lib/sync/deckRegistry';

// ---------------------------------------------------------------------------
// Environment detection
// ---------------------------------------------------------------------------

function isNativePlatform(): boolean {
  try {
    return !!(
      typeof window !== 'undefined' &&
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).Capacitor?.isNativePlatform?.()
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Registry persistence (local-only file)
// ---------------------------------------------------------------------------

const REGISTRY_PATH = 'deck_registry.json';
const REGISTRY_LS_KEY = 'kit_deck_registry';

async function loadRegistryJson(): Promise<string | null> {
  if (isNativePlatform()) {
    try {
      const result = await Filesystem.readFile({
        path: REGISTRY_PATH,
        directory: Directory.Documents,
      });
      return typeof result.data === 'string' ? result.data : null;
    } catch {
      return null;
    }
  }
  return localStorage.getItem(REGISTRY_LS_KEY);
}

async function saveRegistryJson(json: string): Promise<void> {
  if (isNativePlatform()) {
    try {
      await Filesystem.writeFile({
        path: REGISTRY_PATH,
        data: json,
        directory: Directory.Documents,
      });
    } catch {
      // Best effort
    }
  } else {
    localStorage.setItem(REGISTRY_LS_KEY, json);
  }
}

// ---------------------------------------------------------------------------
// Hook return type
// ---------------------------------------------------------------------------

export interface UseDeckManagerReturn {
  /** True while WASM / registry is loading. */
  loading: boolean;
  /** Non-empty string if initialization failed. */
  error: string;
  /** List of known decks (from registry). */
  deckEntries: DeckRegistryEntry[];
  /** Refresh deck list from iCloud. */
  refreshDecks: () => Promise<void>;
  /**
   * Open a deck and get its Database instance.
   * Returns null if the deck can't be loaded.
   */
  openDeckDb: (deckId: string) => Promise<Database | null>;
  /** Get a cached deck Database (must be previously opened). */
  getCachedDeckDb: (deckId: string) => Database | null;
  /** Close a deck to free memory. */
  closeDeckDb: (deckId: string) => void;
  /**
   * Apply edit operations to a deck: writes to local DB + syncs to iCloud.
   * This replaces the old persistDatabase() + scheduleICloudBackup() pattern.
   */
  writeEdit: (deckId: string, ops: EditOp[]) => Promise<string | null>;
  /** Compact a deck's edit files (call after study session). */
  compact: (deckId: string) => Promise<void>;
  /** Sync a deck by replaying new edits from iCloud. */
  sync: (deckId: string) => Promise<number>;
  /** Create a new deck from a snapshot (used during import). */
  createFromSnapshot: typeof createDeckFromSnapshot;
  /** Refresh cached card counts for an open deck. */
  refreshCounts: (deckId: string) => void;
  /** Persist the deck registry. */
  saveRegistry: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Initialize the per-deck sync architecture.
 *
 * @returns Deck management interface.
 */
export function useDeckManager(): UseDeckManagerReturn {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deckEntries, setDeckEntries] = useState<DeckRegistryEntry[]>([]);
  const initializedRef = useRef(false);

  // ── Init ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    let cancelled = false;

    async function init() {
      try {
        // 1. Load WASM
        const locateFile = (file: string) => `/${file}`;
        configureSqlJsPath(locateFile);
        const wasmBinary = await fetch('/sql-wasm.wasm').then(r => r.arrayBuffer());
        configureWasmBinary(wasmBinary);
        const SQL = await initSqlJs({ locateFile, wasmBinary });
        if (cancelled) return;

        // 2. Create storage backend
        const storage = isNativePlatform()
          ? createICloudSyncStorage()
          : createBrowserSyncStorage();

        // 3. Load registry
        const registryJson = await loadRegistryJson();
        if (cancelled) return;

        // 4. Initialize DeckManager
        initDeckManager({ SQL, storage, registryJson });

        // 5. Check if migration from monolithic DB is needed
        const hasRegistry = registryJson !== null;
        let hasMonolithicDb = false;

        if (isNativePlatform()) {
          try {
            const stat = await Filesystem.stat({
              path: 'kit.db',
              directory: Directory.Documents,
            });
            hasMonolithicDb = stat.size > 0;
          } catch {
            hasMonolithicDb = false;
          }
        } else {
          hasMonolithicDb = localStorage.getItem('kit_db_snapshot') !== null;
        }

        if (needsMigration(hasMonolithicDb, hasRegistry)) {
          if (cancelled) return;
          try {
            const snapshot = await loadDatabaseSnapshot();
            if (snapshot && snapshot !== 'too_large') {
              const deviceId = getDeviceId();
              const migratedCount = await migrateMonolithicDb(
                SQL, snapshot, storage, deviceId,
              );
              console.log(`[useDeckManager] Migrated ${migratedCount} decks`);

              // Save registry after migration
              await saveRegistryJson(getRegistryJson());

              // Rename old kit.db as safety backup
              if (isNativePlatform()) {
                try {
                  await Filesystem.rename({
                    from: 'kit.db',
                    to: 'kit.db.migrated',
                    directory: Directory.Documents,
                  });
                } catch {
                  // Best effort
                }
              }
            }
          } catch (e) {
            console.warn('[useDeckManager] Migration failed:', e);
            // Non-fatal — will retry next launch
          }
        }

        // 6. Discover decks from iCloud
        const entries = await discoverDecks();
        if (cancelled) return;

        setDeckEntries(entries);
        setLoading(false);
      } catch (e) {
        if (!cancelled) {
          setError(String(e));
          setLoading(false);
        }
      }
    }

    init();

    return () => { cancelled = true; };
  }, []);

  // ── Refresh deck list ──────────────────────────────────────────────────
  const refreshDecks = useCallback(async () => {
    const entries = await discoverDecks();
    setDeckEntries(entries);
  }, []);

  // ── Open a deck ────────────────────────────────────────────────────────
  const openDeckDb = useCallback(async (deckId: string): Promise<Database | null> => {
    return openDeck(deckId);
  }, []);

  // ── Get cached deck DB ─────────────────────────────────────────────────
  const getCachedDeckDb = useCallback((deckId: string): Database | null => {
    return getDeckDb(deckId);
  }, []);

  // ── Close a deck ───────────────────────────────────────────────────────
  const closeDeckDb = useCallback((deckId: string): void => {
    closeDeck(deckId);
  }, []);

  // ── Write edit ─────────────────────────────────────────────────────────
  const writeEditFn = useCallback(async (
    deckId: string,
    ops: EditOp[],
  ): Promise<string | null> => {
    return applyAndSync(deckId, ops);
  }, []);

  // ── Compact ────────────────────────────────────────────────────────────
  const compact = useCallback(async (deckId: string): Promise<void> => {
    await compactDeckEdits(deckId);
    await saveRegistryJson(getRegistryJson());
  }, []);

  // ── Sync ───────────────────────────────────────────────────────────────
  const sync = useCallback(async (deckId: string): Promise<number> => {
    return syncDeck(deckId);
  }, []);

  // ── Refresh counts ─────────────────────────────────────────────────────
  const refreshCountsFn = useCallback((deckId: string): void => {
    refreshDeckCounts(deckId);
  }, []);

  // ── Save registry ──────────────────────────────────────────────────────
  const saveRegistry = useCallback(async (): Promise<void> => {
    await saveRegistryJson(getRegistryJson());
  }, []);

  return {
    loading,
    error,
    deckEntries,
    refreshDecks,
    openDeckDb,
    getCachedDeckDb,
    closeDeckDb,
    writeEdit: writeEditFn,
    compact,
    sync,
    createFromSnapshot: createDeckFromSnapshot,
    refreshCounts: refreshCountsFn,
    saveRegistry,
  };
}
