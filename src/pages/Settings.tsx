/**
 * Settings page — backup status and manual backup trigger.
 *
 * Layout:
 *  ┌──────────────────────────┐
 *  │  ← Back   Settings      │
 *  ├──────────────────────────┤
 *  │  iCloud Backup           │
 *  │  Last backup: ...        │
 *  │  [ Back Up Now ]         │
 *  └──────────────────────────┘
 */

import { useCallback } from 'react';
import type { Database } from 'sql.js';
import { useBackup } from '../hooks/useBackup';
import type { BackupMeta } from '../lib/platform/icloud';
import { hapticTap } from '../lib/platform/haptics';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SettingsProps {
  db: Database | null;
  onBack: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format a Unix timestamp (seconds) to a human-readable string.
 *
 * @param ts - Unix timestamp in seconds.
 * @returns Formatted date/time string.
 */
function formatTimestamp(ts: number): string {
  const date = new Date(ts * 1000);
  const now = new Date();
  const isToday =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();

  const time = date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });

  if (isToday) return `Today at ${time}`;

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday =
    date.getDate() === yesterday.getDate() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getFullYear() === yesterday.getFullYear();

  if (isYesterday) return `Yesterday at ${time}`;

  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  }) + ` at ${time}`;
}

/** Render the backup status details. */
function BackupDetails({ meta }: { meta: BackupMeta }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between text-sm">
        <span className="text-[#737373]">Last backup</span>
        <span className="text-[#171717] dark:text-[#E5E5E5]">
          {formatTimestamp(meta.timestamp)}
        </span>
      </div>
      <div className="flex justify-between text-sm">
        <span className="text-[#737373]">Cards</span>
        <span className="text-[#171717] dark:text-[#E5E5E5]">
          {meta.cardCount}
        </span>
      </div>
      <div className="flex justify-between text-sm">
        <span className="text-[#737373]">Device</span>
        <span className="text-[#171717] dark:text-[#E5E5E5]">
          {meta.deviceName}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * Settings page with iCloud backup status and controls.
 *
 * @param db     - sql.js Database instance (null while loading).
 * @param onBack - Called when the user navigates back.
 */
export default function Settings({ db, onBack }: SettingsProps) {
  const {
    phase,
    errorMessage,
    lastBackup,
    checking,
    backupNow,
    reset,
  } = useBackup(db);

  const handleBackup = useCallback(async () => {
    hapticTap();
    await backupNow();
  }, [backupNow]);

  const isBackingUp = phase === 'backing-up';

  return (
    <div className="min-h-screen bg-[#FAFAFA] dark:bg-[#0A0A0A] text-[#171717] dark:text-[#E5E5E5] font-mono">
      {/* Header */}
      <header className="flex items-center px-4 pt-safe-top pb-3 border-b border-[#E5E5E5] dark:border-[#262626]">
        <button
          onClick={() => { hapticTap(); onBack(); }}
          className="text-sm text-[#737373] hover:text-[#171717] dark:hover:text-[#E5E5E5] transition-colors mr-3"
        >
          ← Back
        </button>
        <span className="text-sm font-semibold tracking-widest uppercase">
          Settings
        </span>
      </header>

      {/* iCloud Backup section */}
      <section className="px-4 py-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[#737373] mb-3">
          iCloud Backup
        </h2>

        <div className="bg-white dark:bg-[#141414] border border-[#E5E5E5] dark:border-[#262626] rounded-lg p-4 flex flex-col gap-4">
          {/* Status */}
          {checking ? (
            <div className="flex items-center gap-3">
              <div className="w-4 h-4 border-2 border-[#171717] dark:border-[#E5E5E5] border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-[#737373]">
                Checking backup status…
              </span>
            </div>
          ) : lastBackup ? (
            <BackupDetails meta={lastBackup} />
          ) : (
            <p className="text-sm text-[#737373]">
              No backup found. Back up your cards to iCloud Drive so you can
              restore them on a new device.
            </p>
          )}

          {/* Backup progress */}
          {isBackingUp && (
            <div className="flex items-center gap-3">
              <div className="w-4 h-4 border-2 border-[#171717] dark:border-[#E5E5E5] border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-[#737373]">
                Backing up…
              </span>
            </div>
          )}

          {/* Success */}
          {phase === 'done' && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-green-600 dark:text-green-400">
                Backup complete!
              </p>
              <button
                onClick={reset}
                className="text-xs text-[#737373] underline"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Error */}
          {phase === 'error' && errorMessage && (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-red-500">{errorMessage}</p>
              <button
                onClick={reset}
                className="text-xs text-[#737373] underline self-start"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Manual backup button */}
          <button
            onClick={handleBackup}
            disabled={isBackingUp || !db}
            className="w-full py-3 text-sm font-semibold border border-[#D4D4D4] dark:border-[#404040] rounded-lg text-[#171717] dark:text-[#E5E5E5] disabled:opacity-40 disabled:cursor-not-allowed active:bg-[#F0F0F0] dark:active:bg-[#1A1A1A] transition-colors"
          >
            {isBackingUp ? 'Backing up…' : 'Back Up Now'}
          </button>
        </div>
      </section>
    </div>
  );
}
