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

import { useEffect, useState } from 'react';
import type { Database } from 'sql.js';
import {
  getDeckStats,
  type DeckStats as DeckStatsType,
} from '../lib/db/queries';
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
    <div className="flex flex-col items-center gap-1 p-3 bg-[var(--kit-surface)] border border-[#E5E5E5] dark:border-[#262626] rounded-lg">
      <span className="text-lg font-semibold text-[#1c1c1e] dark:text-[#E5E5E5] tabular-nums">
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
                className="w-full rounded-sm bg-[#1c1c1e] dark:bg-[#E5E5E5]"
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

  useEffect(() => {
    if (!db) return;
    const now = Math.floor(Date.now() / 1000);
    const statsResult = getDeckStats(db, deckId, now);
    if (statsResult.success) setStats(statsResult.data);
  }, [db, deckId]);

  if (!stats) {
    return (
      <div className="min-h-[100dvh] flex flex-col bg-[var(--kit-bg)] text-[#1c1c1e] dark:text-[#E5E5E5]">
        <header
          className="flex items-center pb-3 border-b border-[#E5E5E5] dark:border-[#262626] shrink-0"
          style={{
            paddingTop: 'env(safe-area-inset-top)',
            paddingLeft: 'max(1rem, env(safe-area-inset-left))',
            paddingRight: 'max(1rem, env(safe-area-inset-right))',
          }}
        >
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
        <button onClick={() => { hapticTap(); onBack(); }} className="text-sm text-[#737373] mr-3">&larr; Back</button>
        <span className="text-sm font-semibold truncate">{deckName}</span>
      </header>

      {/* Scrollable content with safe area */}
      <div
        className="flex-1 min-h-0 overflow-auto"
        style={{
          paddingBottom: 'max(1rem, env(safe-area-inset-bottom))',
          paddingLeft: 'max(1rem, env(safe-area-inset-left))',
          paddingRight: 'max(1rem, env(safe-area-inset-right))',
        }}
      >
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
        <div className="bg-[var(--kit-surface)] border border-[#E5E5E5] dark:border-[#262626] rounded-lg p-4">
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
        <div className="bg-[var(--kit-surface)] border border-[#E5E5E5] dark:border-[#262626] rounded-lg p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[#737373] mb-3">
            Reviews — Last 7 Days
          </h3>
          <ReviewChart data={stats.reviewsPerDay} />
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
