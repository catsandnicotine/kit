/**
 * useDatabase — initialises a sql.js database with the Kit schema,
 * restoring from a persisted snapshot if one exists.
 *
 * Persistence:
 *  - On startup: loads the saved snapshot (localStorage or Capacitor Filesystem).
 *    If found, the database is hydrated from that snapshot instead of starting empty.
 *  - If no local snapshot exists, checks iCloud Drive for a backup and exposes
 *    the metadata so the UI can prompt the user to restore.
 *  - After writes: callers invoke {@link persistDatabase} to export the current
 *    state back to storage. This is debounced (5 s) so rapid writes during import
 *    or study sessions don't thrash storage.
 *
 * The sql-wasm.wasm file must be served from the public root.
 * This hook is meant to be called once at the root level.
 */

import { useCallback, useEffect, useState } from 'react';
import type { Database } from 'sql.js';
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import { ALL_TABLES, ENABLE_FOREIGN_KEYS } from '../lib/db';
import { runMigrations } from '../lib/db/migrations';
import { configureSqlJsPath, configureWasmBinary } from '../lib/apkg';
import {
  loadDatabaseSnapshot,
  saveDatabaseSnapshot,
} from '../lib/platform/persistence';
import { migrateMediaBlobsToFiles } from '../lib/platform/mediaFiles';
import { seedWelcomeDeck } from '../lib/db/welcomeDeck';
import {
  checkForBackup,
  restoreDatabase as restoreICloudBackup,
  type BackupMeta,
} from '../lib/platform/icloud';
import { scheduleICloudBackup } from './useBackup';

// ---------------------------------------------------------------------------
// Module-level singleton — allows any hook to call persistDatabase()
// without prop-drilling.
// ---------------------------------------------------------------------------

let _db: Database | null = null;
let _debounceTimer: ReturnType<typeof setTimeout> | null = null;

const PERSIST_DEBOUNCE_MS = 5_000;

/**
 * Persist the current in-memory database to durable storage.
 *
 * Debounced to 5 seconds so that bulk write operations (import, study
 * sessions) don't hammer localStorage / filesystem on every individual INSERT.
 * The final snapshot is always written — the debounce only collapses
 * intermediate calls.
 *
 * Safe to call from any module — does nothing if the database hasn't been
 * initialised yet.
 */
export function persistDatabase(): void {
  if (!_db) return;

  if (_debounceTimer !== null) clearTimeout(_debounceTimer);

  _debounceTimer = setTimeout(() => {
    _debounceTimer = null;
    if (!_db) return;
    try {
      const data = _db.export();
      saveDatabaseSnapshot(data);
    } catch (e) {
      console.warn('[useDatabase] Failed to persist database:', e);
    }
  }, PERSIST_DEBOUNCE_MS);
}

/**
 * Persist the database and schedule an iCloud backup in one call.
 * Use this instead of calling `persistDatabase()` + `scheduleICloudBackup()` separately.
 */
export function persistAndBackup(): void {
  persistDatabase();
  scheduleICloudBackup();
}

/**
 * Flush any pending debounced persist immediately.
 * Called before the page unloads to avoid losing the last few seconds of writes.
 */
function flushPersist(): void {
  if (_debounceTimer !== null && _db) {
    clearTimeout(_debounceTimer);
    _debounceTimer = null;
    try {
      const data = _db.export();
      saveDatabaseSnapshot(data);
    } catch {
      // Best-effort on unload — can't do much if it fails.
    }
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseDatabaseReturn {
  db: Database | null;
  /** True while the WASM is loading or the schema is being applied. */
  loading: boolean;
  /** Non-empty string if initialisation failed. */
  error: string;
  /**
   * True when the on-disk snapshot is too large to safely load (would OOM
   * the WKWebView process). The UI should offer a data-reset path.
   */
  dbTooLarge: boolean;
  /** Wipe the on-disk snapshot and all media files, then reload. */
  resetDatabase: () => Promise<void>;
  /**
   * Non-null when no local DB exists but an iCloud backup was found.
   * The UI should prompt the user to restore or skip.
   */
  icloudBackupAvailable: BackupMeta | null;
  /** Accept the iCloud restore — replaces the empty database with the backup. */
  acceptRestore: () => Promise<void>;
  /** Decline the iCloud restore — continue with an empty database. */
  declineRestore: () => void;
}

/**
 * Initialise a sql.js database (restoring from snapshot if available)
 * and apply the Kit schema.
 *
 * @returns Reactive database handle, loading flag, and any error message.
 */
export function useDatabase(): UseDatabaseReturn {
  const [db, setDb] = useState<Database | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dbTooLarge, setDbTooLarge] = useState(false);
  const [icloudBackupAvailable, setIcloudBackupAvailable] = useState<BackupMeta | null>(null);
  const [sqlRef, setSqlRef] = useState<SqlJsStatic | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const locateFile = (file: string) => `/${file}`;
        configureSqlJsPath(locateFile);

        // Pre-fetch the WASM binary before calling initSqlJs.
        // On Capacitor iOS, WKURLSchemeHandler serves .wasm without
        // Content-Type: application/wasm, causing WebAssembly.instantiateStreaming
        // to fail. The ArrayBuffer fallback then also fails because the iOS
        // networking process hasn't finished launching at cold start.
        // Handing the bytes directly to sql.js bypasses both fetch attempts.
        const wasmBinary = await fetch('/sql-wasm.wasm').then(r => r.arrayBuffer());
        configureWasmBinary(wasmBinary);
        const SQL = await initSqlJs({ locateFile, wasmBinary });
        if (cancelled) return;
        setSqlRef(SQL);

        // Try to restore a previously-persisted database.
        const snapshot = await loadDatabaseSnapshot();
        if (cancelled) return;

        if (snapshot === 'too_large') {
          // Snapshot is too large to load safely — would OOM WKWebView.
          // Surface the error so the UI can offer a reset path.
          setDbTooLarge(true);
          setLoading(false);
          return;
        }

        if (snapshot) {
          // Local snapshot found — use it directly.
          const database = new SQL.Database(snapshot);
          database.run(ENABLE_FOREIGN_KEYS);
          for (const ddl of ALL_TABLES) {
            database.run(ddl);
          }
          runMigrations(database);
          _db = database;
          setDb(database);
          setLoading(false);
          // One-time async migration: extract media BLOBs to the filesystem
          // so future snapshots won't be bloated by binary data.
          migrateMediaBlobsToFiles(database, saveDatabaseSnapshot).catch(() => {});
          return;
        }

        // No local snapshot — check iCloud for a backup.
        const icloudMeta = await checkForBackup();
        if (cancelled) return;

        if (icloudMeta) {
          // iCloud backup found — don't create DB yet, wait for user decision.
          setIcloudBackupAvailable(icloudMeta);
          setLoading(false);
          return;
        }

        // No local snapshot and no iCloud backup — fresh start.
        const database = new SQL.Database();
        database.run(ENABLE_FOREIGN_KEYS);
        for (const ddl of ALL_TABLES) {
          database.run(ddl);
        }
        runMigrations(database);
        seedWelcomeDeck(database);
        _db = database;
        setDb(database);
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    init();

    // Flush pending persist on page unload so we don't lose the last writes.
    window.addEventListener('beforeunload', flushPersist);

    return () => {
      cancelled = true;
      window.removeEventListener('beforeunload', flushPersist);
    };
  }, []);

  // ── iCloud restore: accept ────────────────────────────────────────────
  const acceptRestore = useCallback(async () => {
    if (!sqlRef) return;

    setLoading(true);
    setIcloudBackupAvailable(null);

    try {
      const icloudData = await restoreICloudBackup();
      const database = icloudData
        ? new sqlRef.Database(icloudData)
        : new sqlRef.Database();

      database.run(ENABLE_FOREIGN_KEYS);
      for (const ddl of ALL_TABLES) {
        database.run(ddl);
      }
      runMigrations(database);

      _db = database;
      setDb(database);

      // Persist the restored data locally so it's available on next launch.
      if (icloudData) {
        const data = database.export();
        await saveDatabaseSnapshot(data);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [sqlRef]);

  // ── iCloud restore: decline ───────────────────────────────────────────
  const declineRestore = useCallback(() => {
    if (!sqlRef) return;

    setIcloudBackupAvailable(null);

    const database = new sqlRef.Database();
    database.run(ENABLE_FOREIGN_KEYS);
    for (const ddl of ALL_TABLES) {
      database.run(ddl);
    }
    runMigrations(database);
    seedWelcomeDeck(database);

    _db = database;
    setDb(database);
  }, [sqlRef]);

  // ── Reset database (for the too-large / crash-loop case) ────────────
  const resetDatabase = useCallback(async () => {
    try {
      const { Filesystem, Directory } = await import('@capacitor/filesystem');
      try {
        await Filesystem.deleteFile({ path: 'kit.db', directory: Directory.Documents });
      } catch { /* file may not exist */ }
      try {
        await Filesystem.rmdir({ path: 'media', directory: Directory.Documents, recursive: true });
      } catch { /* directory may not exist */ }
    } catch { /* Filesystem not available in browser */ }
    // Reload the page so useDatabase re-initialises from scratch.
    window.location.reload();
  }, []);

  return { db, loading, error, dbTooLarge, resetDatabase, icloudBackupAvailable, acceptRestore, declineRestore };
}
