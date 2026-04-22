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
  flushPendingSync,
  getAllGlobalTags,
  upsertGlobalTag as upsertGlobalTagFn,
  deleteGlobalTag as deleteGlobalTagFn,
  renameGlobalTag as renameGlobalTagFn,
  mergeTagsIntoGlobal as mergeTagsIntoGlobalFn,
  removeDeck as removeDeckFn,
  removeDeckLocalOnly,
  isDeckFailed,
  subscribeToFailureChanges,
} from '../lib/db/deckManager';
import { createICloudSyncStorage } from '../lib/platform/icloudSync';
import { createBrowserSyncStorage } from '../lib/platform/browserSync';
import { loadDatabaseSnapshot } from '../lib/platform/persistence';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { atomicReadText, atomicWriteText } from '../lib/platform/atomicWrite';
import type { DeckRegistryEntry, EditOp, GlobalTag } from '../lib/sync/types';
import { needsMigration, migrateMonolithicDb } from '../lib/sync/migration';
import { getDeviceId, getAllDeckEntries } from '../lib/sync/deckRegistry';
import { evictOrphanedMedia } from '../lib/platform/mediaFiles';
import { isNativePlatform } from '../lib/platform/platformDetect';

// ---------------------------------------------------------------------------
// Local snapshot persistence (on-device backup, not iCloud)
// ---------------------------------------------------------------------------

const LOCAL_DECKS_DIR = 'decks';

/**
 * Delete the local snapshot directory for a deck.
 * Called during deck deletion to free on-device storage.
 */
async function deleteLocalDeckSnapshot(deckId: string): Promise<void> {
  if (!isNativePlatform()) return;
  try {
    await Filesystem.rmdir({
      path: `${LOCAL_DECKS_DIR}/${deckId}`,
      directory: Directory.Documents,
      recursive: true,
    });
  } catch {
    // Directory may not exist — ignore
  }
}

/**
 * Read a deck snapshot from the local on-device store.
 * This is the primary reliable store; iCloud is for cross-device sync only.
 * Recovers from a prior interrupted write via the .bak fallback.
 */
async function readLocalSnapshot(deckId: string): Promise<string | null> {
  if (!isNativePlatform()) return null;
  return atomicReadText({
    path: `${LOCAL_DECKS_DIR}/${deckId}/snapshot.json`,
    directory: Directory.Documents,
  });
}

/**
 * Write a deck snapshot to the local on-device store atomically.
 * Called on every import and compaction to ensure the deck is always
 * openable on this device regardless of iCloud availability. Under
 * interruption (power loss, force-kill) the previous committed snapshot
 * is preserved; readers never see a half-written file.
 */
async function writeLocalSnapshot(deckId: string, data: string): Promise<void> {
  if (!isNativePlatform()) return;
  try {
    await Filesystem.mkdir({
      path: `${LOCAL_DECKS_DIR}/${deckId}`,
      directory: Directory.Documents,
      recursive: true,
    });
  } catch {
    // Directory already exists — expected on subsequent writes
  }
  try {
    await atomicWriteText({
      path: `${LOCAL_DECKS_DIR}/${deckId}/snapshot.json`,
      data,
      directory: Directory.Documents,
    });
  } catch (e) {
    console.warn('[snapshot] Failed to write local snapshot:', e);
  }
}

// ---------------------------------------------------------------------------
// Registry persistence (local-only file)
// ---------------------------------------------------------------------------

const REGISTRY_PATH = 'deck_registry.json';
const REGISTRY_LS_KEY = 'kit_deck_registry';

/** localStorage key — set when a deck is deleted; cleared after eviction runs. */
const LS_EVICT_MEDIA_KEY = 'kit_evict_media';

async function loadRegistryJson(): Promise<string | null> {
  if (isNativePlatform()) {
    try {
      const result = await Filesystem.readFile({
        path: REGISTRY_PATH,
        directory: Directory.Documents,
        encoding: Encoding.UTF8,
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
        encoding: Encoding.UTF8,
      });
    } catch {
      // Best effort
    }
  } else {
    localStorage.setItem(REGISTRY_LS_KEY, json);
  }
}

async function persistRegistry(): Promise<void> {
  await saveRegistryJson(getRegistryJson());
}

// ---------------------------------------------------------------------------
// Migration backup cleanup
// ---------------------------------------------------------------------------

/** Days after which the kit.db.migrated safety backup is deleted. */
const MIGRATION_BACKUP_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** localStorage key — set once we've confirmed kit.db.migrated is gone. */
const LS_MIG_BACKUP_GONE = 'kit_mig_backup_gone';

/**
 * Delete kit.db.migrated if it is older than 30 days.
 * Once the file is confirmed absent (deleted or never existed) the result is
 * cached in localStorage so we never stat the filesystem again.
 */
async function cleanupMigrationBackup(): Promise<void> {
  try {
    if (localStorage.getItem(LS_MIG_BACKUP_GONE)) return;
  } catch { /* localStorage unavailable */ }

  try {
    const stat = await Filesystem.stat({
      path: 'kit.db.migrated',
      directory: Directory.Documents,
    });
    const modifiedMs = stat.mtime ? new Date(stat.mtime).getTime() : 0;
    if (modifiedMs > 0 && Date.now() - modifiedMs > MIGRATION_BACKUP_MAX_AGE_MS) {
      await Filesystem.deleteFile({
        path: 'kit.db.migrated',
        directory: Directory.Documents,
      });
      try { localStorage.setItem(LS_MIG_BACKUP_GONE, '1'); } catch {}
    }
    // File still exists but isn't old enough yet — check again next launch.
  } catch {
    // stat failed → file doesn't exist; remember so we never check again.
    try { localStorage.setItem(LS_MIG_BACKUP_GONE, '1'); } catch {}
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
  /** Refresh deck list from the in-memory registry. */
  refreshDecks: () => void;
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
  /** Flush pending edits that were queued while offline. */
  flushPending: () => Promise<number>;
  /** Persist the deck registry. */
  saveRegistry: () => Promise<void>;
  /** Get all tags from the global catalog. */
  getGlobalTags: () => GlobalTag[];
  /** Create or update a tag in the global catalog (persists immediately). */
  upsertTag: (name: string, color: string) => Promise<void>;
  /** Delete a tag from the global catalog (persists immediately). */
  deleteTag: (name: string) => Promise<void>;
  /** Rename a tag in the global catalog (persists immediately). */
  renameTag: (oldName: string, newName: string) => Promise<void>;
  /** Merge imported tags into the global catalog (persists immediately). */
  mergeImportedTags: (tags: Array<{ tag: string; color: string }>) => Promise<void>;
  /**
   * Permanently delete a deck: closes DB, removes from registry, deletes local
   * snapshot, and best-effort deletes iCloud files. Caller must also delete media.
   */
  removeDeck: (deckId: string) => Promise<void>;
  /**
   * Remove this deck's local copy only (iCloud is preserved). Used for the
   * "Remove from this device" recovery action — never destroys more than
   * the user asked for.
   */
  removeDeckLocal: (deckId: string) => Promise<void>;
  /** Set of deck IDs whose last open attempt failed. Re-rendered on change. */
  failedDeckIds: ReadonlySet<string>;
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
  const [failedDeckIds, setFailedDeckIds] = useState<ReadonlySet<string>>(new Set());
  const initializedRef = useRef(false);

  // Subscribe to deck-health changes from the deckManager so the UI can
  // dim rows whose last open attempt failed and show the recovery sheet.
  useEffect(() => {
    return subscribeToFailureChanges(() => {
      // Build a fresh Set so React re-renders consumers.
      setFailedDeckIds(prev => {
        const next = new Set<string>();
        for (const entry of deckEntries) {
          if (isDeckFailed(entry.deckId)) next.add(entry.deckId);
        }
        // Also preserve any failures we were already tracking (entries that
        // might not be in deckEntries yet on first mount).
        for (const id of prev) {
          if (isDeckFailed(id)) next.add(id);
        }
        return next;
      });
    });
  }, [deckEntries]);

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
        initDeckManager({ SQL, storage, registryJson, readLocalSnapshot, writeLocalSnapshot, deleteLocalSnapshot: deleteLocalDeckSnapshot });

        // 5. Check if migration from monolithic DB is needed.
        // If the registry already exists, migration already happened — skip the
        // filesystem stat entirely.
        const hasRegistry = registryJson !== null;
        let hasMonolithicDb = false;

        if (!hasRegistry) {
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
        }

        if (needsMigration(hasMonolithicDb, hasRegistry)) {
          if (cancelled) return;
          try {
            const snapshot = await loadDatabaseSnapshot();
            if (snapshot && snapshot !== 'too_large') {
              const deviceId = getDeviceId();
              await migrateMonolithicDb(
                SQL, snapshot, storage, deviceId,
              );

              // Save registry after migration
              await persistRegistry();

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

        // 6. Clean up migration backup after 30 days
        if (isNativePlatform() && hasRegistry) {
          cleanupMigrationBackup().catch(() => {});
        }

        // 7. Discover decks from iCloud
        const entries = await discoverDecks();
        if (cancelled) return;

        setDeckEntries(entries);
        setLoading(false);

        // 8. Evict media for orphaned/deleted decks — only when a deck was recently
        //    deleted (flagged via LS_EVICT_MEDIA_KEY). Skipped on normal cold starts.
        if (isNativePlatform()) {
          let needsEviction = false;
          try { needsEviction = localStorage.getItem(LS_EVICT_MEDIA_KEY) === '1'; } catch {}
          if (needsEviction) {
            try { localStorage.removeItem(LS_EVICT_MEDIA_KEY); } catch {}
            const activeIds = new Set(entries.map(e => e.deckId));
            evictOrphanedMedia(activeIds).catch(() => {});
          }
        }
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
  // The real-time iCloud watcher (useSync) handles incoming changes from other
  // devices. refreshDecks just re-reads the in-memory registry so the UI
  // reflects any writes that happened since the last render.
  const refreshDecks = useCallback(() => {
    setDeckEntries(getAllDeckEntries());
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
    await persistRegistry();
  }, []);

  // ── Sync ───────────────────────────────────────────────────────────────
  const sync = useCallback(async (deckId: string): Promise<number> => {
    return syncDeck(deckId);
  }, []);

  // ── Refresh counts ─────────────────────────────────────────────────────
  const refreshCountsFn = useCallback((deckId: string): void => {
    refreshDeckCounts(deckId);
  }, []);

  // ── Flush pending edits ────────────────────────────────────────────────
  const flushPendingFn = useCallback(async (): Promise<number> => {
    return flushPendingSync();
  }, []);

  // ── Save registry ──────────────────────────────────────────────────────
  const saveRegistry = useCallback(async (): Promise<void> => {
    await persistRegistry();
  }, []);

  // ── Global tag catalog ────────────────────────────────────────────────
  const getGlobalTags = useCallback((): GlobalTag[] => {
    return getAllGlobalTags();
  }, []);

  const upsertTag = useCallback(async (name: string, color: string): Promise<void> => {
    upsertGlobalTagFn(name, color);
    await persistRegistry();
  }, []);

  const deleteTagFn = useCallback(async (name: string): Promise<void> => {
    deleteGlobalTagFn(name);
    await persistRegistry();
  }, []);

  const renameTagFn = useCallback(async (oldName: string, newName: string): Promise<void> => {
    renameGlobalTagFn(oldName, newName);
    await persistRegistry();
  }, []);

  const mergeImportedTags = useCallback(async (
    tags: Array<{ tag: string; color: string }>,
  ): Promise<void> => {
    mergeTagsIntoGlobalFn(tags);
    await persistRegistry();
  }, []);

  const removeDeckFnCb = useCallback(async (deckId: string): Promise<void> => {
    await removeDeckFn(deckId);
    await persistRegistry();
    // Flag that media eviction is needed on the next cold start.
    try { localStorage.setItem(LS_EVICT_MEDIA_KEY, '1'); } catch {}
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
    flushPending: flushPendingFn,
    saveRegistry,
    getGlobalTags,
    upsertTag,
    deleteTag: deleteTagFn,
    renameTag: renameTagFn,
    mergeImportedTags,
    removeDeck: removeDeckFnCb,
    removeDeckLocal: removeDeckLocalOnly,
    failedDeckIds,
  };
}
