/**
 * useBackup — manages iCloud Drive backup lifecycle.
 *
 * Triggers backup after study sessions, imports, and edits — debounced to
 * no more than once per 5 minutes. Provides backup status for Settings UI
 * and a manual backup trigger.
 *
 * Other hooks call the module-level {@link scheduleICloudBackup} function
 * (same pattern as persistDatabase) to schedule a backup after writes.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Database } from 'sql.js';
import {
  backupDatabase,
  checkForBackup,
  type BackupMeta,
} from '../lib/platform/icloud';
import { getTotalCardCount } from '../lib/db/queries';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum interval between automatic backups (5 minutes). */
const BACKUP_DEBOUNCE_MS = 5 * 60 * 1000;

/** localStorage key for last backup timestamp (browser dev fallback). */
const LS_LAST_BACKUP_KEY = 'kit_last_backup_ts';

// ---------------------------------------------------------------------------
// Module-level state — allows any hook to call scheduleICloudBackup()
// without prop-drilling, same pattern as persistDatabase().
// ---------------------------------------------------------------------------

let _backupDb: Database | null = null;
let _backupTimer: ReturnType<typeof setTimeout> | null = null;
let _lastBackupTime = 0;

/**
 * Module-level cache for backup metadata.
 * Populated on the first iCloud check; reused on subsequent Settings opens
 * so we never scan iCloud more than once per session.
 */
let _cachedBackupMeta: BackupMeta | null = null;
let _backupMetaFetched = false;

// Restore last backup time from localStorage on module load.
try {
  const raw = localStorage.getItem(LS_LAST_BACKUP_KEY);
  if (raw) _lastBackupTime = Number(raw);
} catch {
  // Ignore — first launch or no localStorage.
}

/**
 * Schedule an iCloud backup. Debounced to at most once per 5 minutes.
 *
 * Safe to call from any module — does nothing if the database hasn't been
 * initialised yet or if we're in browser dev mode.
 */
export function scheduleICloudBackup(): void {
  if (!_backupDb) return;
  if (_backupTimer !== null) return; // Already scheduled.

  const elapsed = Date.now() - _lastBackupTime;
  const delay = Math.max(0, BACKUP_DEBOUNCE_MS - elapsed);

  _backupTimer = setTimeout(async () => {
    _backupTimer = null;
    if (!_backupDb) return;

    try {
      const countResult = getTotalCardCount(_backupDb);
      const cardCount = countResult.success ? countResult.data : 0;
      // Yield one tick before the blocking export so pending UI frames can flush.
      await new Promise(resolve => setTimeout(resolve, 0));
      if (!_backupDb) return;
      const data = _backupDb.export();
      const success = await backupDatabase(data, cardCount);

      if (success) {
        _lastBackupTime = Date.now();
        try {
          localStorage.setItem(LS_LAST_BACKUP_KEY, String(_lastBackupTime));
        } catch {
          // Best effort.
        }
      }
    } catch {
      // Backup is best-effort — don't crash the app.
    }
  }, delay);
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type BackupPhase = 'idle' | 'backing-up' | 'done' | 'error';

export interface UseBackupReturn {
  /** Current phase of the backup pipeline. */
  phase: BackupPhase;
  /** Error message when phase is 'error'. */
  errorMessage: string;
  /** Metadata from the last known backup (null if never backed up). */
  lastBackup: BackupMeta | null;
  /** True while checking iCloud for existing backup metadata. */
  checking: boolean;
  /** Trigger a manual backup immediately, bypassing the debounce. */
  backupNow: () => Promise<void>;
  /**
   * Signal that a write occurred (study, import, edit).
   * Debounced — the actual backup fires at most once per 5 minutes.
   */
  scheduleBackup: () => void;
  /** Reset back to idle. */
  reset: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Hook that manages iCloud backup state and scheduling.
 *
 * @param db - sql.js Database instance (null while loading).
 * @returns Backup state and actions.
 */
export function useBackup(db: Database | null): UseBackupReturn {
  const [phase, setPhase] = useState<BackupPhase>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [lastBackup, setLastBackup] = useState<BackupMeta | null>(null);
  const [checking, setChecking] = useState(true);
  const dbRef = useRef(db);
  dbRef.current = db;

  // Keep module-level reference in sync.
  useEffect(() => {
    _backupDb = db;
  }, [db]);

  // ── Check for existing backup on mount ──────────────────────────────
  // Uses a module-level cache so re-opening Settings never hits iCloud twice.
  // The cache is updated after a successful backupNow().
  useEffect(() => {
    let cancelled = false;

    async function check() {
      // Fast path: already fetched this session — apply cached result immediately.
      if (_backupMetaFetched) {
        if (!cancelled) {
          setLastBackup(_cachedBackupMeta);
          if (_cachedBackupMeta) _lastBackupTime = _cachedBackupMeta.timestamp * 1000;
          setChecking(false);
        }
        return;
      }

      try {
        const meta = await checkForBackup();
        _cachedBackupMeta = meta;
        _backupMetaFetched = true;
        if (!cancelled) {
          setLastBackup(meta);
          if (meta) _lastBackupTime = meta.timestamp * 1000;
        }
      } catch {
        _backupMetaFetched = true; // Don't retry on transient error.
      } finally {
        if (!cancelled) setChecking(false);
      }
    }

    check();
    return () => { cancelled = true; };
  }, []);

  // ── Cleanup module-level timer on unmount ────────────────────────────
  useEffect(() => {
    return () => {
      if (_backupTimer !== null) {
        clearTimeout(_backupTimer);
        _backupTimer = null;
      }
    };
  }, []);

  const reset = useCallback(() => {
    setPhase('idle');
    setErrorMessage('');
  }, []);

  // ── Manual backup (bypasses debounce) ────────────────────────────────
  const backupNow = useCallback(async () => {
    const currentDb = dbRef.current;
    if (!currentDb) return;

    // Cancel any pending scheduled backup.
    if (_backupTimer !== null) {
      clearTimeout(_backupTimer);
      _backupTimer = null;
    }

    setPhase('backing-up');
    setErrorMessage('');

    try {
      const countResult = getTotalCardCount(currentDb);
      const cardCount = countResult.success ? countResult.data : 0;

      const data = currentDb.export();
      const success = await backupDatabase(data, cardCount);

      if (success) {
        const now = Math.floor(Date.now() / 1000);
        const meta: BackupMeta = {
          timestamp: now,
          cardCount,
          deviceName: 'iOS Device',
          appVersion: '1.0.0',
        };
        setLastBackup(meta);
        // Update module-level cache so re-opening Settings reflects the new backup.
        _cachedBackupMeta = meta;
        _backupMetaFetched = true;
        _lastBackupTime = Date.now();
        try {
          localStorage.setItem(LS_LAST_BACKUP_KEY, String(_lastBackupTime));
        } catch {
          // Best effort.
        }
      }

      setPhase('done');
    } catch (e) {
      setPhase('error');
      setErrorMessage(`Backup failed: ${String(e)}`);
    }
  }, []);

  // ── Scheduled backup wrapper (for the hook consumer) ─────────────────
  const scheduleBackupHook = useCallback(() => {
    scheduleICloudBackup();
  }, []);

  return {
    phase,
    errorMessage,
    lastBackup,
    checking,
    backupNow,
    scheduleBackup: scheduleBackupHook,
    reset,
  };
}
