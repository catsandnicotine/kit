/**
 * DeckSettings page — per-deck configuration with plain-English descriptions.
 *
 * Uses native <select> elements for numeric values which show the iOS
 * scroll wheel picker.
 */

import { useCallback, useEffect, useState } from 'react';
import type { Database } from 'sql.js';
import {
  getDeckSettings,
  setNewCardsPerDay,
  setDeckLearningSteps,
  setDeckSetting,
  type DeckSettings as DeckSettingsType,
} from '../lib/db/queries';
import { persistDatabase } from '../hooks/useDatabase';
import { hapticTap } from '../lib/platform/haptics';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface DeckSettingsProps {
  db: Database | null;
  deckId: string;
  deckName: string;
  onBack: () => void;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Native <select> that triggers the iOS scroll wheel picker. */
function WheelPicker({
  value,
  options,
  onChange,
  suffix,
}: {
  value: number;
  options: number[];
  onChange: (v: number) => void;
  suffix?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => { hapticTap(); onChange(Number(e.target.value)); }}
      className="bg-[#F0F0F0] dark:bg-[#262626] border border-[#D4D4D4] dark:border-[#404040] rounded-lg px-3 py-2 text-sm font-semibold text-[#1c1c1e] dark:text-[#E5E5E5] tabular-nums outline-none appearance-none text-center min-w-[4.5rem]"
    >
      {options.map((n) => (
        <option key={n} value={n}>{n}{suffix ?? ''}</option>
      ))}
    </select>
  );
}

/** A settings row with label, description, and control. */
function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-sm">{label}</span>
        {children}
      </div>
      <p className="text-[11px] text-[#A3A3A3] mt-1 leading-relaxed">{description}</p>
    </div>
  );
}

/** Section card with header and description. */
function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="px-4 pb-4">
      <div className="bg-[var(--kit-surface)] border border-[#E5E5E5] dark:border-[#262626] rounded-lg p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[#737373] mb-1">
          {title}
        </h3>
        {description && (
          <p className="text-xs text-[#A3A3A3] mb-3 leading-relaxed">{description}</p>
        )}
        <div className="flex flex-col gap-4">
          {children}
        </div>
      </div>
    </section>
  );
}

// Pre-generate option arrays
const DAILY_LIMIT_OPTIONS = Array.from({ length: 101 }, (_, i) => i * 5); // 0–500
const REVIEW_LIMIT_OPTIONS = [50, 100, 150, 200, 300, 500, 1000, 9999];
const INTERVAL_OPTIONS = Array.from({ length: 60 }, (_, i) => i + 1); // 1–60
const MAX_INTERVAL_OPTIONS = [7, 14, 30, 60, 90, 120, 180, 365, 730, 1825, 3650];
const LEECH_OPTIONS = [0, 4, 6, 8, 10, 12, 15, 20]; // 0 = disabled

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * Deck settings page.
 *
 * @param db       - sql.js Database instance.
 * @param deckId   - UUID of the deck.
 * @param deckName - Human-readable deck name.
 * @param onBack   - Navigate back.
 */
export default function DeckSettings({ db, deckId, deckName, onBack }: DeckSettingsProps) {
  const [settings, setSettings] = useState<DeckSettingsType | null>(null);
  const [limit, setLimit] = useState(20);
  const [maxReviews, setMaxReviews] = useState(200);
  const [gradInt, setGradInt] = useState(1);
  const [easyInt, setEasyInt] = useState(4);
  const [maxInterval, setMaxInterval] = useState(365);
  const [leechThreshold, setLeechThreshold] = useState(8);
  const [draftSteps, setDraftSteps] = useState('1, 10');

  useEffect(() => {
    if (!db) return;
    const settingsResult = getDeckSettings(db, deckId);
    if (settingsResult.success) {
      const d = settingsResult.data;
      setSettings(d);
      setLimit(d.newCardsPerDay);
      setMaxReviews(d.maxReviewsPerDay);
      setDraftSteps(d.againSteps.join(', '));
      setGradInt(d.graduatingInterval);
      setEasyInt(d.easyInterval);
      setMaxInterval(d.maxInterval);
      setLeechThreshold(d.leechThreshold);
    }
  }, [db, deckId]);

  /** Save all learning-related settings at once. */
  const saveLearningSettings = useCallback((
    steps: string,
    grad: number,
    easy: number,
  ) => {
    if (!db) return;
    const parsed = steps.split(',').map(s => Number(s.trim())).filter(n => !isNaN(n) && n > 0);
    if (parsed.length === 0) return;
    const result = setDeckLearningSteps(db, deckId, parsed, grad, easy);
    if (result.success) {
      setSettings(prev => prev ? { ...prev, againSteps: parsed, graduatingInterval: grad, easyInterval: easy } : prev);
      persistDatabase();
    }
  }, [db, deckId]);

  const handleSaveLimit = useCallback((val: number) => {
    if (!db) return;
    setLimit(val);
    const result = setNewCardsPerDay(db, deckId, val);
    if (result.success) {
      setSettings(prev => prev ? { ...prev, newCardsPerDay: val } : prev);
      persistDatabase();
    }
  }, [db, deckId]);

  const handleSaveMaxReviews = useCallback((val: number) => {
    if (!db) return;
    setMaxReviews(val);
    const result = setDeckSetting(db, deckId, 'max_reviews_per_day', val);
    if (result.success) {
      setSettings(prev => prev ? { ...prev, maxReviewsPerDay: val } : prev);
      persistDatabase();
    }
  }, [db, deckId]);

  const handleSaveMaxInterval = useCallback((val: number) => {
    if (!db) return;
    setMaxInterval(val);
    const result = setDeckSetting(db, deckId, 'max_interval', val);
    if (result.success) {
      setSettings(prev => prev ? { ...prev, maxInterval: val } : prev);
      persistDatabase();
    }
  }, [db, deckId]);

  const handleSaveLeechThreshold = useCallback((val: number) => {
    if (!db) return;
    setLeechThreshold(val);
    const result = setDeckSetting(db, deckId, 'leech_threshold', val);
    if (result.success) {
      setSettings(prev => prev ? { ...prev, leechThreshold: val } : prev);
      persistDatabase();
    }
  }, [db, deckId]);

  if (!settings) {
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
        <span className="text-sm font-semibold truncate">Settings — {deckName}</span>
      </header>

      <div
        className="flex-1 min-h-0 overflow-auto"
        style={{
          paddingBottom: 'max(1rem, env(safe-area-inset-bottom))',
          paddingLeft: 'max(1rem, env(safe-area-inset-left))',
          paddingRight: 'max(1rem, env(safe-area-inset-right))',
        }}
      >
        {/* Daily Limits */}
        <div className="pt-4" />
        <Section
          title="Daily Limits"
          description="Controls how many cards you see each day. Lower limits prevent burnout; higher limits speed up progress."
        >
          <SettingRow
            label="New cards per day"
            description="How many unseen cards to introduce each day. Start with 20 and adjust based on how you feel."
          >
            <WheelPicker value={limit} options={DAILY_LIMIT_OPTIONS} onChange={handleSaveLimit} />
          </SettingRow>

          <SettingRow
            label="Max reviews per day"
            description="Cap on review cards per session. If you fall behind, this prevents a mountain of reviews. Learning cards always show up regardless."
          >
            <WheelPicker
              value={maxReviews}
              options={REVIEW_LIMIT_OPTIONS}
              onChange={handleSaveMaxReviews}
            />
          </SettingRow>
        </Section>

        {/* Learning Steps */}
        <Section
          title="When You're Learning a Card"
          description="New cards go through short-term practice before entering long-term review. These settings control that initial practice."
        >
          <SettingRow
            label="Practice intervals"
            description={'When you get a card wrong (or it\'s brand new), it comes back after these delays. Example: "1, 10" means you\'ll see it again in 1 minute, then 10 minutes.'}
          >
            <input
              type="text"
              value={draftSteps}
              onChange={(e) => setDraftSteps(e.target.value)}
              onBlur={() => saveLearningSettings(draftSteps, gradInt, easyInt)}
              className="w-24 text-center bg-[#F0F0F0] dark:bg-[#262626] border border-[#D4D4D4] dark:border-[#404040] rounded-lg px-2 py-2 text-[#1c1c1e] dark:text-[#E5E5E5] outline-none"
              placeholder="1, 10"
            />
          </SettingRow>

          <SettingRow
            label="First review after learning"
            description={'Once you pass all practice steps, how many days until the card comes back for its first real review.'}
          >
            <WheelPicker
              value={gradInt}
              options={INTERVAL_OPTIONS}
              onChange={(v) => { setGradInt(v); saveLearningSettings(draftSteps, v, easyInt); }}
            />
          </SettingRow>

          <SettingRow
            label={'"Easy" shortcut'}
            description={'If you press "Easy" on a new card, it skips practice and goes straight to review after this many days. Use this for cards you already know.'}
          >
            <WheelPicker
              value={easyInt}
              options={INTERVAL_OPTIONS}
              onChange={(v) => { setEasyInt(v); saveLearningSettings(draftSteps, gradInt, v); }}
            />
          </SettingRow>
        </Section>

        {/* Advanced */}
        <Section
          title="Long-Term Review"
          description="Controls how the spaced repetition algorithm schedules cards you've already learned."
        >
          <SettingRow
            label="Maximum wait between reviews"
            description="The longest a card can go before you see it again. Shorter = more reviews but better retention. 365 days works for most people."
          >
            <WheelPicker
              value={maxInterval}
              options={MAX_INTERVAL_OPTIONS}
              onChange={handleSaveMaxInterval}
            />
          </SettingRow>

          <SettingRow
            label="Trouble card detection"
            description={'If you get a card wrong this many times, Kit will pause it and let you know. Set to 0 to disable. These "leech" cards usually need to be rewritten.'}
          >
            <WheelPicker
              value={leechThreshold}
              options={LEECH_OPTIONS}
              onChange={handleSaveLeechThreshold}
            />
          </SettingRow>
        </Section>
      </div>
    </div>
  );
}
