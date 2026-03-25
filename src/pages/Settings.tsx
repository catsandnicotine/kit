/**
 * Settings page — theme, study preferences, backup, learning steps, stats.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
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
  applyRetentionToAllDecks,
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
// Icons
// ---------------------------------------------------------------------------

function SunIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="4" />
      <line x1="12" y1="2" x2="12" y2="5" />
      <line x1="12" y1="19" x2="12" y2="22" />
      <line x1="4.22" y1="4.22" x2="6.34" y2="6.34" />
      <line x1="17.66" y1="17.66" x2="19.78" y2="19.78" />
      <line x1="2" y1="12" x2="5" y2="12" />
      <line x1="19" y1="12" x2="22" y2="12" />
      <line x1="4.22" y1="19.78" x2="6.34" y2="17.66" />
      <line x1="17.66" y1="6.34" x2="19.78" y2="4.22" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function BlackMoonIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9z" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// StepsEditor
// ---------------------------------------------------------------------------

/** Editable chip list for learning step minutes. */
function StepsEditor({
  steps,
  onChange,
}: {
  steps: number[];
  onChange: (s: number[]) => void;
}) {
  const [isAdding, setIsAdding] = useState(false);
  const [draftValue, setDraftValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isAdding) inputRef.current?.focus();
  }, [isAdding]);

  const commit = () => {
    const n = parseInt(draftValue, 10);
    if (!isNaN(n) && n > 0) onChange([...steps, n]);
    setDraftValue('');
    setIsAdding(false);
  };

  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {steps.map((s, i) => (
        <div
          key={i}
          className="flex items-center gap-1 bg-[#F0F0F0] dark:bg-[#262626] border border-[#D4D4D4] dark:border-[#404040] rounded-lg px-2.5 py-1.5"
        >
          <span className="text-sm font-semibold tabular-nums">{s}m</span>
          {steps.length > 1 && (
            <button
              onClick={() => onChange(steps.filter((_, idx) => idx !== i))}
              className="text-[#C4C4C4] text-base leading-none ml-0.5"
            >
              ×
            </button>
          )}
        </div>
      ))}
      {isAdding ? (
        <input
          ref={inputRef}
          type="number"
          value={draftValue}
          onChange={(e) => setDraftValue(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') { setDraftValue(''); setIsAdding(false); }
          }}
          className="w-16 text-center bg-[#F0F0F0] dark:bg-[#262626] border border-[#D4D4D4] dark:border-[#404040] rounded-lg px-2 py-1.5 text-sm font-semibold outline-none"
          placeholder="min"
          min={1}
        />
      ) : (
        <button
          onClick={() => setIsAdding(true)}
          className="flex items-center justify-center w-8 h-8 rounded-lg border border-dashed border-[#D4D4D4] dark:border-[#404040] text-[#C4C4C4] text-xl leading-none"
        >
          +
        </button>
      )}
    </div>
  );
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
        <span className="text-[#C4C4C4]">Last backup</span>
        <span className="text-[#1c1c1e] dark:text-[#E5E5E5]">
          {formatTimestamp(meta.timestamp)}
        </span>
      </div>
      <div className="flex justify-between text-sm">
        <span className="text-[#C4C4C4]">Cards</span>
        <span className="text-[#1c1c1e] dark:text-[#E5E5E5]">
          {meta.cardCount}
        </span>
      </div>
      <div className="flex justify-between text-sm">
        <span className="text-[#C4C4C4]">Device</span>
        <span className="text-[#1c1c1e] dark:text-[#E5E5E5]">
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
 * Settings page with theme, study preferences, backup, learning steps, and stats.
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
    currentStreak: number;
  } | null>(null);

  // Show/hide timer
  const [showTimer, setShowTimer] = useState(() => {
    try { return localStorage.getItem('kit_show_timer') !== 'false'; } catch { return true; }
  });

  // Default learning steps
  const [defaultStepsArr, setDefaultStepsArr] = useState<number[]>([1, 10]);
  const [defaultGradInt, setDefaultGradInt] = useState(1);
  const [defaultEasyInt, setDefaultEasyInt] = useState(4);

  // Retention tooltip visibility
  const [showRetentionInfo, setShowRetentionInfo] = useState(false);

  // Default retention
  const [defaultRetention, setDefaultRetention] = useState(0.9);

  // Load settings
  useEffect(() => {
    if (!db) return;
    const now = Math.floor(Date.now() / 1000);
    const statsResult = getGlobalStats(db, now);
    if (statsResult.success) setGlobalStats(statsResult.data);

    const stepsResult = getAppSetting(db, 'default_again_steps');
    if (stepsResult.success && stepsResult.data) {
      const parsed = stepsResult.data.split(',').map(s => Number(s.trim())).filter(n => !isNaN(n) && n > 0);
      if (parsed.length > 0) setDefaultStepsArr(parsed);
    }

    const gradResult = getAppSetting(db, 'default_graduating_interval');
    if (gradResult.success && gradResult.data) setDefaultGradInt(Number(gradResult.data) || 1);

    const easyResult = getAppSetting(db, 'default_easy_interval');
    if (easyResult.success && easyResult.data) setDefaultEasyInt(Number(easyResult.data) || 4);

    const retResult = getAppSetting(db, 'default_retention');
    if (retResult.success && retResult.data) setDefaultRetention(Number(retResult.data) || 0.9);
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

  const saveDefaultSteps = useCallback((steps = defaultStepsArr) => {
    if (!db) return;
    setAppSetting(db, 'default_again_steps', steps.join(', '));
    setAppSetting(db, 'default_graduating_interval', String(defaultGradInt));
    setAppSetting(db, 'default_easy_interval', String(defaultEasyInt));
    persistDatabase();
    hapticTap();
  }, [db, defaultStepsArr, defaultGradInt, defaultEasyInt]);

  const applyToAllDecks = useCallback(() => {
    if (!db || defaultStepsArr.length === 0) return;
    applyLearningStepsToAllDecks(db, defaultStepsArr, defaultGradInt || 1, defaultEasyInt || 4);
    saveDefaultSteps();
  }, [db, defaultStepsArr, defaultGradInt, defaultEasyInt, saveDefaultSteps]);

  const handleSaveRetention = useCallback((val: number) => {
    if (!db) return;
    setDefaultRetention(val);
    setAppSetting(db, 'default_retention', String(val));
    applyRetentionToAllDecks(db, val);
    persistDatabase();
  }, [db]);

  const applyToNewOnly = useCallback(() => {
    saveDefaultSteps();
  }, [saveDefaultSteps]);

  const THEME_OPTIONS: { value: Theme; label: string; icon: React.ReactNode }[] = [
    { value: 'light', label: 'Light', icon: <SunIcon /> },
    { value: 'dark',  label: 'Dark',  icon: <MoonIcon /> },
    { value: 'black', label: 'Black', icon: <BlackMoonIcon /> },
  ];

  return (
    <div className="min-h-[100dvh] flex flex-col bg-[var(--kit-bg)] text-[#1c1c1e] dark:text-[#E5E5E5]">
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
          className="text-sm font-medium text-[#C4C4C4] hover:text-[#1c1c1e] dark:hover:text-[#E5E5E5] transition-colors mr-3"
        >
          ← Back
        </button>
        <span className="text-base font-bold">
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
        {/* ── Appearance ── */}
        <section className="py-4">
          <h2 className="text-sm font-semibold text-[#C4C4C4] mb-3">Appearance</h2>
          <div className="bg-[var(--kit-surface)] border border-[#E5E5E5] dark:border-[#262626] rounded-lg p-4 flex flex-col gap-4">
            <div className="flex gap-2">
              {THEME_OPTIONS.map(({ value, label, icon }) => (
                <button
                  key={value}
                  onClick={() => handleThemeChange(value)}
                  className={`flex-1 py-2.5 flex flex-col items-center gap-1.5 text-xs rounded-md border transition-colors ${
                    theme === value
                      ? 'bg-[#1c1c1e] dark:bg-[#E5E5E5] text-white dark:text-[#0A0A0A] border-transparent font-semibold'
                      : 'border-[#D4D4D4] dark:border-[#404040] text-[#C4C4C4]'
                  }`}
                >
                  {icon}
                  <span>{label}</span>
                </button>
              ))}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Show session timer</span>
              <button
                onClick={handleTimerToggle}
                className={`w-11 h-6 rounded-full transition-colors relative ${showTimer ? 'bg-[#1c1c1e] dark:bg-[#E5E5E5]' : 'bg-[#D4D4D4] dark:bg-[#404040]'}`}
              >
                <div
                  className={`absolute top-0.5 w-5 h-5 rounded-full bg-[#FDFBF7] dark:bg-[var(--kit-bg)] transition-transform ${showTimer ? 'translate-x-[22px]' : 'translate-x-0.5'}`}
                />
              </button>
            </div>
          </div>
        </section>

        {/* ── Study Preferences ── */}
        <section className="pb-4">
          <h2 className="text-sm font-semibold text-[#C4C4C4] mb-3">Study</h2>
          <div className="bg-[var(--kit-surface)] border border-[#E5E5E5] dark:border-[#262626] rounded-lg p-4 flex flex-col gap-4">
            <div>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1">
                  <span className="text-sm font-medium">Target retention</span>
                  <button
                    onClick={() => { hapticTap(); setShowRetentionInfo(v => !v); }}
                    aria-label="More info"
                    className="text-[#C4C4C4]"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <path d="M12 16v-4M12 8h.01" />
                    </svg>
                  </button>
                </div>
                <span className="text-sm font-semibold tabular-nums">{Math.round(defaultRetention * 100)}%</span>
              </div>
              {showRetentionInfo && (
                <p className="text-[11px] text-[#C4C4C4] mb-1 leading-relaxed">How often you should remember a card when it comes due. Higher = more frequent reviews but better memory. Applied to all decks.</p>
              )}
              <input
                type="range"
                min={70}
                max={99}
                step={1}
                value={Math.round(defaultRetention * 100)}
                onChange={e => handleSaveRetention(Number(e.target.value) / 100)}
                className="w-full accent-[#1c1c1e] dark:accent-[#E5E5E5]"
              />
              <div className="flex justify-between text-[11px] text-[#C4C4C4] mt-0.5">
                <span>70%</span>
                <span>99%</span>
              </div>
            </div>
          </div>
        </section>

        {/* ── iCloud Backup ── */}
        <section className="pb-4">
          <h2 className="text-sm font-semibold text-[#C4C4C4] mb-3">iCloud Backup</h2>

          <div className="bg-[var(--kit-surface)] border border-[#E5E5E5] dark:border-[#262626] rounded-lg p-4 flex flex-col gap-4">
            {checking ? (
              <div className="flex items-center gap-3">
                <div className="w-4 h-4 border-2 border-[#1c1c1e] dark:border-[#E5E5E5] border-t-transparent rounded-full animate-spin" />
                <span className="text-sm text-[#C4C4C4]">Checking backup status…</span>
              </div>
            ) : lastBackup ? (
              <BackupDetails meta={lastBackup} />
            ) : (
              <p className="text-sm text-[#C4C4C4]">
                No backup found. Back up your cards to iCloud Drive so you can restore them on a new device.
              </p>
            )}

            {isBackingUp && (
              <div className="flex items-center gap-3">
                <div className="w-4 h-4 border-2 border-[#1c1c1e] dark:border-[#E5E5E5] border-t-transparent rounded-full animate-spin" />
                <span className="text-sm text-[#C4C4C4]">Backing up…</span>
              </div>
            )}

            {phase === 'done' && (
              <div className="flex items-center justify-between">
                <p className="text-sm text-green-600 dark:text-green-400">Backup complete!</p>
                <button onClick={reset} className="text-xs text-[#C4C4C4] underline">Dismiss</button>
              </div>
            )}

            {phase === 'error' && errorMessage && (
              <div className="flex flex-col gap-2">
                <p className="text-sm text-red-500">{errorMessage}</p>
                <button onClick={reset} className="text-xs text-[#C4C4C4] underline self-start">Dismiss</button>
              </div>
            )}

            <button
              onClick={handleBackup}
              disabled={isBackingUp || !db}
              className="w-full py-3 text-sm font-semibold border border-[#D4D4D4] dark:border-[#404040] rounded-lg text-[#1c1c1e] dark:text-[#E5E5E5] disabled:opacity-40 disabled:cursor-not-allowed active:bg-[#F0F0F0] dark:active:bg-[#1A1A1A] transition-colors"
            >
              {isBackingUp ? 'Backing up…' : 'Back Up Now'}
            </button>
          </div>
        </section>

        {/* ── Default Learning Settings ── */}
        <section className="pb-4">
          <h2 className="text-sm font-semibold text-[#C4C4C4] mb-1">Default Learning Settings</h2>
          <p className="text-xs text-[#C4C4C4] mb-3 leading-relaxed">
            These apply to newly imported decks. Customize each deck individually in its own settings.
          </p>
          <div className="bg-[var(--kit-surface)] border border-[#E5E5E5] dark:border-[#262626] rounded-lg p-4 flex flex-col gap-4">
            <div>
              <span className="text-sm font-medium">Practice intervals</span>
              <p className="text-[11px] text-[#C4C4C4] mt-0.5 leading-relaxed">Minutes to wait before re-showing a card you got wrong.</p>
              <StepsEditor
                steps={defaultStepsArr}
                onChange={(s) => { setDefaultStepsArr(s); saveDefaultSteps(s); }}
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">First review after learning</span>
              <select
                value={defaultGradInt}
                onChange={(e) => { hapticTap(); setDefaultGradInt(Number(e.target.value)); }}
                className="bg-[#F0F0F0] dark:bg-[#262626] border border-[#D4D4D4] dark:border-[#404040] rounded-lg px-3 py-2 text-sm font-semibold text-[#1c1c1e] dark:text-[#E5E5E5] tabular-nums outline-none appearance-none text-center min-w-[4.5rem]"
              >
                {Array.from({ length: 60 }, (_, i) => i + 1).map(n => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Easy interval</span>
              <select
                value={defaultEasyInt}
                onChange={(e) => { hapticTap(); setDefaultEasyInt(Number(e.target.value)); }}
                className="bg-[#F0F0F0] dark:bg-[#262626] border border-[#D4D4D4] dark:border-[#404040] rounded-lg px-3 py-2 text-sm font-semibold text-[#1c1c1e] dark:text-[#E5E5E5] tabular-nums outline-none appearance-none text-center min-w-[4.5rem]"
              >
                {Array.from({ length: 60 }, (_, i) => i + 1).map(n => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={applyToAllDecks}
                className="flex-1 py-2 text-xs font-semibold border border-[#D4D4D4] dark:border-[#404040] rounded-lg text-[#1c1c1e] dark:text-[#E5E5E5] active:bg-[#F0F0F0] dark:active:bg-[#1A1A1A]"
              >
                Apply to all decks
              </button>
              <button
                onClick={applyToNewOnly}
                className="flex-1 py-2 text-xs border border-[#D4D4D4] dark:border-[#404040] rounded-lg text-[#C4C4C4] active:bg-[#F0F0F0] dark:active:bg-[#1A1A1A]"
              >
                New decks only
              </button>
            </div>
          </div>
        </section>

        {/* ── Global Stats ── */}
        {globalStats && (
          <section className="pb-4">
            <h2 className="text-sm font-semibold text-[#C4C4C4] mb-3">Statistics</h2>
            <div className="bg-[var(--kit-surface)] border border-[#E5E5E5] dark:border-[#262626] rounded-lg p-4">
              <div className="grid grid-cols-4 gap-2">
                <div className="flex flex-col items-center gap-0.5">
                  <span className="text-lg font-semibold tabular-nums">{globalStats.totalCards.toLocaleString()}</span>
                  <span className="text-[10px] text-[#C4C4C4] text-center">Cards</span>
                </div>
                <div className="flex flex-col items-center gap-0.5">
                  <span className="text-lg font-semibold tabular-nums">{globalStats.totalReviews.toLocaleString()}</span>
                  <span className="text-[10px] text-[#C4C4C4] text-center">Reviews</span>
                </div>
                <div className="flex flex-col items-center gap-0.5">
                  <span className="text-lg font-semibold tabular-nums">{globalStats.retentionRate > 0 ? `${globalStats.retentionRate}%` : '—'}</span>
                  <span className="text-[10px] text-[#C4C4C4] text-center">Retention</span>
                </div>
                <div className="flex flex-col items-center gap-0.5">
                  <span className="text-lg font-semibold tabular-nums">{globalStats.currentStreak > 0 ? `${globalStats.currentStreak}d` : '—'}</span>
                  <span className="text-[10px] text-[#C4C4C4] text-center">Streak</span>
                </div>
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
