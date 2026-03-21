/**
 * Settings page — theme, global stats, learning steps, backup.
 *
 * Layout:
 *  ┌──────────────────────────┐
 *  │  ← Back   Settings      │
 *  ├──────────────────────────┤
 *  │  Theme: Light/Dark/System│
 *  ├──────────────────────────┤
 *  │  Global Stats            │
 *  ├──────────────────────────┤
 *  │  Study Preferences       │
 *  ├──────────────────────────┤
 *  │  Default Learning Steps  │
 *  ├──────────────────────────┤
 *  │  iCloud Backup           │
 *  └──────────────────────────┘
 */

import { useCallback, useEffect, useState } from 'react';
import type { Database } from 'sql.js';
import type { Theme } from '../types';
import { useBackup } from '../hooks/useBackup';
import { useTheme } from '../hooks/useTheme';
import type { BackupMeta } from '../lib/platform/icloud';
import { hapticTap } from '../lib/platform/haptics';
import {
  getGlobalStats,
  getAppSetting,
  setAppSetting,
  applyLearningStepsToAllDecks,
} from '../lib/db/queries';
import { persistDatabase } from '../hooks/useDatabase';

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
 * Settings page with theme, global stats, learning steps, and backup.
 *
 * @param db     - sql.js Database instance (null while loading).
 * @param onBack - Called when the user navigates back.
 */
export default function Settings({ db, onBack }: SettingsProps) {
  const { theme, setTheme } = useTheme();

  const {
    phase,
    errorMessage,
    lastBackup,
    checking,
    backupNow,
    reset,
  } = useBackup(db);

  // Global stats
  const [globalStats, setGlobalStats] = useState<{
    totalCards: number;
    totalReviews: number;
    retentionRate: number;
    longestStreak: number;
  } | null>(null);

  // Show/hide timer
  const [showTimer, setShowTimer] = useState(() => {
    try { return localStorage.getItem('kit_show_timer') !== 'false'; } catch { return true; }
  });

  // Default learning steps
  const [defaultSteps, setDefaultSteps] = useState('1, 10');
  const [defaultGradInt, setDefaultGradInt] = useState(1);
  const [defaultEasyInt, setDefaultEasyInt] = useState(4);

  // Load settings
  useEffect(() => {
    if (!db) return;
    const now = Math.floor(Date.now() / 1000);
    const statsResult = getGlobalStats(db, now);
    if (statsResult.success) setGlobalStats(statsResult.data);

    const stepsResult = getAppSetting(db, 'default_again_steps');
    if (stepsResult.success && stepsResult.data) setDefaultSteps(stepsResult.data);

    const gradResult = getAppSetting(db, 'default_graduating_interval');
    if (gradResult.success && gradResult.data) setDefaultGradInt(Number(gradResult.data) || 1);

    const easyResult = getAppSetting(db, 'default_easy_interval');
    if (easyResult.success && easyResult.data) setDefaultEasyInt(Number(easyResult.data) || 4);
  }, [db]);

  const handleBackup = useCallback(async () => {
    hapticTap();
    await backupNow();
  }, [backupNow]);

  const isBackingUp = phase === 'backing-up';

  const handleThemeChange = useCallback((t: Theme) => {
    hapticTap();
    setTheme(t);
  }, [setTheme]);

  const handleTimerToggle = useCallback(() => {
    hapticTap();
    setShowTimer(prev => {
      const next = !prev;
      try { localStorage.setItem('kit_show_timer', String(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const saveDefaultSteps = useCallback(() => {
    if (!db) return;
    setAppSetting(db, 'default_again_steps', defaultSteps);
    setAppSetting(db, 'default_graduating_interval', String(defaultGradInt));
    setAppSetting(db, 'default_easy_interval', String(defaultEasyInt));
    persistDatabase();
    hapticTap();
  }, [db, defaultSteps, defaultGradInt, defaultEasyInt]);

  const applyToAllDecks = useCallback(() => {
    if (!db) return;
    const steps = defaultSteps.split(',').map(s => Number(s.trim())).filter(n => !isNaN(n) && n > 0);
    if (steps.length === 0) return;
    applyLearningStepsToAllDecks(db, steps, defaultGradInt || 1, defaultEasyInt || 4);
    saveDefaultSteps();
  }, [db, defaultSteps, defaultGradInt, defaultEasyInt, saveDefaultSteps]);

  const applyToNewOnly = useCallback(() => {
    saveDefaultSteps();
  }, [saveDefaultSteps]);

  return (
    <div className="min-h-[100dvh] flex flex-col bg-[#FAFAFA] dark:bg-[#0A0A0A] text-[#171717] dark:text-[#E5E5E5] font-mono">
      {/* Header */}
      <header
        className="flex items-center pb-3 border-b border-[#E5E5E5] dark:border-[#262626] shrink-0"
        style={{
          paddingTop: 'env(safe-area-inset-top)',
          paddingLeft: 'max(1rem, env(safe-area-inset-left))',
          paddingRight: 'max(1rem, env(safe-area-inset-right))',
        }}
      >
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

      <div
        className="flex-1 overflow-auto"
        style={{
          paddingBottom: 'max(1rem, env(safe-area-inset-bottom))',
          paddingLeft: 'max(1rem, env(safe-area-inset-left))',
          paddingRight: 'max(1rem, env(safe-area-inset-right))',
        }}
      >
        {/* Theme section */}
        <section className="py-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[#737373] mb-3">
            Theme
          </h2>
          <div className="bg-white dark:bg-[#141414] border border-[#E5E5E5] dark:border-[#262626] rounded-lg p-4">
            <div className="flex gap-2">
              {(['light', 'dark', 'system'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => handleThemeChange(t)}
                  className={`flex-1 py-2 text-sm rounded-md border transition-colors ${
                    theme === t
                      ? 'bg-[#171717] dark:bg-[#E5E5E5] text-white dark:text-[#0A0A0A] border-transparent font-semibold'
                      : 'border-[#D4D4D4] dark:border-[#404040] text-[#737373]'
                  }`}
                >
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* Global stats */}
        {globalStats && (
          <section className="pb-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[#737373] mb-3">
              Global Statistics
            </h2>
            <div className="bg-white dark:bg-[#141414] border border-[#E5E5E5] dark:border-[#262626] rounded-lg p-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col items-center gap-0.5">
                  <span className="text-lg font-semibold tabular-nums">{globalStats.totalCards.toLocaleString()}</span>
                  <span className="text-xs text-[#737373]">Total Cards</span>
                </div>
                <div className="flex flex-col items-center gap-0.5">
                  <span className="text-lg font-semibold tabular-nums">{globalStats.totalReviews.toLocaleString()}</span>
                  <span className="text-xs text-[#737373]">Total Reviews</span>
                </div>
                <div className="flex flex-col items-center gap-0.5">
                  <span className="text-lg font-semibold tabular-nums">{globalStats.retentionRate > 0 ? `${globalStats.retentionRate}%` : '—'}</span>
                  <span className="text-xs text-[#737373]">Retention</span>
                </div>
                <div className="flex flex-col items-center gap-0.5">
                  <span className="text-lg font-semibold tabular-nums">{globalStats.longestStreak > 0 ? `${globalStats.longestStreak}d` : '—'}</span>
                  <span className="text-xs text-[#737373]">Streak</span>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Study preferences */}
        <section className="pb-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[#737373] mb-3">
            Study Preferences
          </h2>
          <div className="bg-white dark:bg-[#141414] border border-[#E5E5E5] dark:border-[#262626] rounded-lg p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm">Show session timer</span>
              <button
                onClick={handleTimerToggle}
                className={`w-11 h-6 rounded-full transition-colors relative ${showTimer ? 'bg-[#171717] dark:bg-[#E5E5E5]' : 'bg-[#D4D4D4] dark:bg-[#404040]'}`}
              >
                <div
                  className={`absolute top-0.5 w-5 h-5 rounded-full bg-white dark:bg-[#0A0A0A] transition-transform ${showTimer ? 'translate-x-[22px]' : 'translate-x-0.5'}`}
                />
              </button>
            </div>
          </div>
        </section>

        {/* Default learning steps */}
        <section className="pb-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[#737373] mb-1">
            Default Learning Steps
          </h2>
          <p className="text-xs text-[#A3A3A3] mb-3 leading-relaxed">
            These defaults apply to newly imported decks. You can override them per deck in each deck's settings.
          </p>
          <div className="bg-white dark:bg-[#141414] border border-[#E5E5E5] dark:border-[#262626] rounded-lg p-4 flex flex-col gap-4">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-sm">Relearn steps</span>
                <input
                  type="text"
                  value={defaultSteps}
                  onChange={(e) => setDefaultSteps(e.target.value)}
                  onBlur={saveDefaultSteps}
                  className="w-24 text-center bg-[#F0F0F0] dark:bg-[#262626] border border-[#D4D4D4] dark:border-[#404040] rounded-lg px-2 py-2 text-[#171717] dark:text-[#E5E5E5] outline-none"
                  placeholder="1, 10"
                />
              </div>
              <p className="text-[11px] text-[#A3A3A3] mt-1">Minutes between re-shows when you press "Again"</p>
            </div>
            <div>
              <div className="flex items-center justify-between">
                <span className="text-sm">Graduating interval</span>
                <select
                  value={defaultGradInt}
                  onChange={(e) => { hapticTap(); setDefaultGradInt(Number(e.target.value)); }}
                  className="bg-[#F0F0F0] dark:bg-[#262626] border border-[#D4D4D4] dark:border-[#404040] rounded-lg px-3 py-2 text-sm font-semibold text-[#171717] dark:text-[#E5E5E5] tabular-nums outline-none appearance-none text-center min-w-[4.5rem]"
                >
                  {Array.from({ length: 60 }, (_, i) => i + 1).map(n => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </div>
              <p className="text-[11px] text-[#A3A3A3] mt-1">Days until next review after passing all learning steps</p>
            </div>
            <div>
              <div className="flex items-center justify-between">
                <span className="text-sm">Easy interval</span>
                <select
                  value={defaultEasyInt}
                  onChange={(e) => { hapticTap(); setDefaultEasyInt(Number(e.target.value)); }}
                  className="bg-[#F0F0F0] dark:bg-[#262626] border border-[#D4D4D4] dark:border-[#404040] rounded-lg px-3 py-2 text-sm font-semibold text-[#171717] dark:text-[#E5E5E5] tabular-nums outline-none appearance-none text-center min-w-[4.5rem]"
                >
                  {Array.from({ length: 60 }, (_, i) => i + 1).map(n => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </div>
              <p className="text-[11px] text-[#A3A3A3] mt-1">Days until next review when you press "Easy" on a new card</p>
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={applyToAllDecks}
                className="flex-1 py-2 text-xs font-semibold border border-[#D4D4D4] dark:border-[#404040] rounded-lg text-[#171717] dark:text-[#E5E5E5] active:bg-[#F0F0F0] dark:active:bg-[#1A1A1A]"
              >
                Apply to all decks
              </button>
              <button
                onClick={applyToNewOnly}
                className="flex-1 py-2 text-xs border border-[#D4D4D4] dark:border-[#404040] rounded-lg text-[#737373] active:bg-[#F0F0F0] dark:active:bg-[#1A1A1A]"
              >
                Apply to new decks only
              </button>
            </div>
          </div>
        </section>

        {/* iCloud Backup section */}
        <section className="pb-4">
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
    </div>
  );
}
