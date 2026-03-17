/**
 * DeckStats page — retention rate, reviews, streak, bar chart.
 *
 * Layout:
 *  ┌──────────────────────────┐
 *  │  ← Back   Deck Stats    │
 *  ├──────────────────────────┤
 *  │  retention   reviews     │
 *  │  streak      cards       │
 *  ├──────────────────────────┤
 *  │  [bar chart: 7 days]     │
 *  ├──────────────────────────┤
 *  │  New cards/day: [20]     │
 *  └──────────────────────────┘
 */

import { useCallback, useEffect, useState } from 'react';
import type { Database } from 'sql.js';
import {
  getDeckStats,
  getDeckSettings,
  setNewCardsPerDay,
  type DeckStats as DeckStatsType,
  type DeckSettings,
} from '../lib/db/queries';
import { persistDatabase } from '../hooks/useDatabase';
import { hapticTap } from '../lib/platform/haptics';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface DeckStatsProps {
  db: Database | null;
  deckId: string;
  deckName: string;
  onBack: () => void;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** A single stat card. */
function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center gap-1 p-3 bg-white dark:bg-[#141414] border border-[#E5E5E5] dark:border-[#262626] rounded-lg">
      <span className="text-lg font-semibold text-[#171717] dark:text-[#E5E5E5] tabular-nums">
        {value}
      </span>
      <span className="text-xs text-[#737373]">{label}</span>
    </div>
  );
}

/** Simple 7-day bar chart. */
function ReviewChart({ data }: { data: number[] }) {
  const max = Math.max(...data, 1);

  const dayLabels = (() => {
    const labels: string[] = [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      labels.push(d.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 2));
    }
    return labels;
  })();

  return (
    <div className="flex items-end gap-1.5 h-24">
      {data.map((count, i) => {
        const height = max > 0 ? Math.max(2, (count / max) * 96) : 2;
        return (
          <div key={i} className="flex-1 flex flex-col items-center gap-1">
            <div className="w-full flex flex-col items-center justify-end" style={{ height: 96 }}>
              {count > 0 && (
                <span className="text-[9px] text-[#737373] tabular-nums mb-0.5">
                  {count}
                </span>
              )}
              <div
                className="w-full rounded-sm bg-[#171717] dark:bg-[#E5E5E5]"
                style={{ height }}
              />
            </div>
            <span className="text-[9px] text-[#A3A3A3]">{dayLabels[i]}</span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * Deck statistics page.
 *
 * @param db       - sql.js Database instance.
 * @param deckId   - UUID of the deck.
 * @param deckName - Human-readable deck name.
 * @param onBack   - Navigate back.
 */
export default function DeckStats({ db, deckId, deckName, onBack }: DeckStatsProps) {
  const [stats, setStats] = useState<DeckStatsType | null>(null);
  const [settings, setSettings] = useState<DeckSettings | null>(null);
  const [draftLimit, setDraftLimit] = useState('20');

  useEffect(() => {
    if (!db) return;
    const now = Math.floor(Date.now() / 1000);

    const statsResult = getDeckStats(db, deckId, now);
    if (statsResult.success) setStats(statsResult.data);

    const settingsResult = getDeckSettings(db, deckId);
    if (settingsResult.success) {
      setSettings(settingsResult.data);
      setDraftLimit(String(settingsResult.data.newCardsPerDay));
    }
  }, [db, deckId]);

  const handleSaveLimit = useCallback(() => {
    if (!db) return;
    const val = Math.max(0, Math.round(Number(draftLimit) || 0));
    const result = setNewCardsPerDay(db, deckId, val);
    if (result.success) {
      setSettings((prev) => prev ? { ...prev, newCardsPerDay: val } : prev);
      setDraftLimit(String(val));
      persistDatabase();
      hapticTap();
    }
  }, [db, deckId, draftLimit]);

  if (!stats) {
    return (
      <div className="min-h-screen bg-[#FAFAFA] dark:bg-[#0A0A0A] text-[#171717] dark:text-[#E5E5E5] font-mono">
        <header className="flex items-center px-4 pt-safe-top pb-3 border-b border-[#E5E5E5] dark:border-[#262626]">
          <button onClick={() => { hapticTap(); onBack(); }} className="text-sm text-[#737373] mr-3">&larr; Back</button>
          <span className="text-sm font-semibold truncate">{deckName}</span>
        </header>
        <div className="flex items-center justify-center py-12">
          <p className="text-sm text-[#737373]">Loading…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FAFAFA] dark:bg-[#0A0A0A] text-[#171717] dark:text-[#E5E5E5] font-mono">
      {/* Header */}
      <header className="flex items-center px-4 pt-safe-top pb-3 border-b border-[#E5E5E5] dark:border-[#262626]">
        <button onClick={() => { hapticTap(); onBack(); }} className="text-sm text-[#737373] mr-3">&larr; Back</button>
        <span className="text-sm font-semibold truncate">{deckName}</span>
      </header>

      {/* Stats grid */}
      <section className="px-4 py-4">
        <div className="grid grid-cols-2 gap-3">
          <StatCard
            label="Retention"
            value={stats.totalReviews > 0 ? `${stats.retentionRate}%` : '—'}
          />
          <StatCard
            label="Total Reviews"
            value={stats.totalReviews.toLocaleString()}
          />
          <StatCard
            label="Streak"
            value={stats.currentStreak > 0 ? `${stats.currentStreak}d` : '—'}
          />
          <StatCard
            label="Cards"
            value={stats.totalCards.toLocaleString()}
          />
        </div>
      </section>

      {/* Cards by state */}
      <section className="px-4 pb-4">
        <div className="bg-white dark:bg-[#141414] border border-[#E5E5E5] dark:border-[#262626] rounded-lg p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[#737373] mb-3">
            Cards by State
          </h3>
          <div className="flex justify-between text-sm">
            <div className="flex flex-col items-center gap-0.5">
              <span className="font-semibold text-blue-500 dark:text-blue-400 tabular-nums">{stats.newCount}</span>
              <span className="text-xs text-[#737373]">New</span>
            </div>
            <div className="flex flex-col items-center gap-0.5">
              <span className="font-semibold text-orange-500 dark:text-orange-400 tabular-nums">{stats.learningCount}</span>
              <span className="text-xs text-[#737373]">Learning</span>
            </div>
            <div className="flex flex-col items-center gap-0.5">
              <span className="font-semibold text-green-500 dark:text-green-400 tabular-nums">{stats.reviewCount}</span>
              <span className="text-xs text-[#737373]">Review</span>
            </div>
          </div>
        </div>
      </section>

      {/* 7-day chart */}
      <section className="px-4 pb-4">
        <div className="bg-white dark:bg-[#141414] border border-[#E5E5E5] dark:border-[#262626] rounded-lg p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[#737373] mb-3">
            Reviews — Last 7 Days
          </h3>
          <ReviewChart data={stats.reviewsPerDay} />
        </div>
      </section>

      {/* New cards per day setting */}
      <section className="px-4 pb-4">
        <div className="bg-white dark:bg-[#141414] border border-[#E5E5E5] dark:border-[#262626] rounded-lg p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[#737373] mb-3">
            Daily Limit
          </h3>
          <div className="flex items-center justify-between">
            <span className="text-sm">New cards per day</span>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0"
                value={draftLimit}
                onChange={(e) => setDraftLimit(e.target.value)}
                onBlur={handleSaveLimit}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSaveLimit(); }}
                className="w-16 text-sm text-center bg-transparent border border-[#D4D4D4] dark:border-[#404040] rounded px-2 py-1 text-[#171717] dark:text-[#E5E5E5] outline-none"
              />
            </div>
          </div>
          {settings && settings.newCardsPerDay !== Number(draftLimit) && (
            <p className="text-xs text-[#A3A3A3] mt-2">Press Enter or tap away to save</p>
          )}
        </div>
      </section>

      {/* Next due */}
      {stats.nextDue && (
        <section className="px-4 pb-4">
          <p className="text-xs text-[#737373] text-center">
            Next review due {formatRelativeTime(stats.nextDue)}
          </p>
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format a future Unix timestamp as relative time.
 *
 * @param ts - Unix timestamp in seconds.
 * @returns Human-readable relative time string.
 */
function formatRelativeTime(ts: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = ts - now;

  if (diff <= 0) return 'now';
  if (diff < 60) return 'in less than a minute';
  if (diff < 3600) {
    const mins = Math.round(diff / 60);
    return `in ${mins} ${mins === 1 ? 'minute' : 'minutes'}`;
  }
  if (diff < 86400) {
    const hours = Math.round(diff / 3600);
    return `in ${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  }
  const days = Math.round(diff / 86400);
  return `in ${days} ${days === 1 ? 'day' : 'days'}`;
}
