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
import { configureSqlJsPath } from '../lib/apkg';
import {
  loadDatabaseSnapshot,
  saveDatabaseSnapshot,
} from '../lib/platform/persistence';
import { seedWelcomeDeck } from '../lib/db/welcomeDeck';
import {
  checkForBackup,
  restoreDatabase as restoreICloudBackup,
  type BackupMeta,
} from '../lib/platform/icloud';

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
  const [icloudBackupAvailable, setIcloudBackupAvailable] = useState<BackupMeta | null>(null);
  const [sqlRef, setSqlRef] = useState<SqlJsStatic | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const locateFile = (file: string) => `/${file}`;
        configureSqlJsPath(locateFile);

        const SQL = await initSqlJs({ locateFile });
        if (cancelled) return;
        setSqlRef(SQL);

        // Try to restore a previously-persisted database.
        const snapshot = await loadDatabaseSnapshot();
        if (cancelled) return;

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

  return { db, loading, error, icloudBackupAvailable, acceptRestore, declineRestore };
}
