/**
 * DeckSettings page — per-deck configuration (daily limit, learning steps).
 *
 * Uses native <select> elements for numeric values which show the iOS
 * scroll wheel picker. Includes explanatory text for each setting so
 * users understand what they're changing.
 */

import { useCallback, useEffect, useState } from 'react';
import type { Database } from 'sql.js';
import {
  getDeckSettings,
  setNewCardsPerDay,
  setDeckLearningSteps,
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
}: {
  value: number;
  options: number[];
  onChange: (v: number) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => { hapticTap(); onChange(Number(e.target.value)); }}
      className="bg-[#F0F0F0] dark:bg-[#262626] border border-[#D4D4D4] dark:border-[#404040] rounded-lg px-3 py-2 text-sm font-semibold text-[#171717] dark:text-[#E5E5E5] tabular-nums outline-none appearance-none text-center min-w-[4.5rem]"
    >
      {options.map((n) => (
        <option key={n} value={n}>{n}</option>
      ))}
    </select>
  );
}

// Pre-generate option arrays
const DAILY_LIMIT_OPTIONS = Array.from({ length: 101 }, (_, i) => i * 5); // 0, 5, 10, ... 500
const INTERVAL_OPTIONS = Array.from({ length: 60 }, (_, i) => i + 1); // 1–60

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
  const [gradInt, setGradInt] = useState(1);
  const [easyInt, setEasyInt] = useState(4);
  const [draftSteps, setDraftSteps] = useState('1, 10');

  useEffect(() => {
    if (!db) return;
    const settingsResult = getDeckSettings(db, deckId);
    if (settingsResult.success) {
      setSettings(settingsResult.data);
      setLimit(settingsResult.data.newCardsPerDay);
      setDraftSteps(settingsResult.data.againSteps.join(', '));
      setGradInt(settingsResult.data.graduatingInterval);
      setEasyInt(settingsResult.data.easyInterval);
    }
  }, [db, deckId]);

  const handleSaveLimit = useCallback((val: number) => {
    if (!db) return;
    setLimit(val);
    const result = setNewCardsPerDay(db, deckId, val);
    if (result.success) {
      setSettings((prev) => prev ? { ...prev, newCardsPerDay: val } : prev);
      persistDatabase();
    }
  }, [db, deckId]);

  const handleSaveSteps = useCallback(() => {
    if (!db) return;
    const steps = draftSteps.split(',').map(s => Number(s.trim())).filter(n => !isNaN(n) && n > 0);
    if (steps.length === 0) return;
    const result = setDeckLearningSteps(db, deckId, steps, gradInt, easyInt);
    if (result.success) {
      setSettings(prev => prev ? { ...prev, againSteps: steps, graduatingInterval: gradInt, easyInterval: easyInt } : prev);
      setDraftSteps(steps.join(', '));
      persistDatabase();
      hapticTap();
    }
  }, [db, deckId, draftSteps, gradInt, easyInt]);

  const handleGradIntChange = useCallback((val: number) => {
    setGradInt(val);
    if (!db) return;
    const steps = draftSteps.split(',').map(s => Number(s.trim())).filter(n => !isNaN(n) && n > 0);
    if (steps.length === 0) return;
    const result = setDeckLearningSteps(db, deckId, steps, val, easyInt);
    if (result.success) {
      setSettings(prev => prev ? { ...prev, graduatingInterval: val } : prev);
      persistDatabase();
    }
  }, [db, deckId, draftSteps, easyInt]);

  const handleEasyIntChange = useCallback((val: number) => {
    setEasyInt(val);
    if (!db) return;
    const steps = draftSteps.split(',').map(s => Number(s.trim())).filter(n => !isNaN(n) && n > 0);
    if (steps.length === 0) return;
    const result = setDeckLearningSteps(db, deckId, steps, gradInt, val);
    if (result.success) {
      setSettings(prev => prev ? { ...prev, easyInterval: val } : prev);
      persistDatabase();
    }
  }, [db, deckId, draftSteps, gradInt]);

  if (!settings) {
    return (
      <div className="min-h-[100dvh] flex flex-col bg-[#FAFAFA] dark:bg-[#0A0A0A] text-[#171717] dark:text-[#E5E5E5] font-mono">
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
        {/* Daily Limit */}
        <section className="px-4 py-4">
          <div className="bg-white dark:bg-[#141414] border border-[#E5E5E5] dark:border-[#262626] rounded-lg p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#737373] mb-1">
              Daily Limit
            </h3>
            <p className="text-xs text-[#A3A3A3] mb-3 leading-relaxed">
              How many new cards to introduce each day. More cards means faster progress but heavier review load.
            </p>
            <div className="flex items-center justify-between">
              <span className="text-sm">New cards per day</span>
              <WheelPicker
                value={limit}
                options={DAILY_LIMIT_OPTIONS}
                onChange={handleSaveLimit}
              />
            </div>
          </div>
        </section>

        {/* Learning Steps */}
        <section className="px-4 pb-4">
          <div className="bg-white dark:bg-[#141414] border border-[#E5E5E5] dark:border-[#262626] rounded-lg p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#737373] mb-1">
              Learning Steps
            </h3>
            <p className="text-xs text-[#A3A3A3] mb-3 leading-relaxed">
              When you press "Again" on a card, it re-appears after these intervals (in minutes). Once you pass all steps, the card "graduates" to a longer schedule.
            </p>
            <div className="flex flex-col gap-4">
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">Relearn steps</span>
                  <input
                    type="text"
                    value={draftSteps}
                    onChange={(e) => setDraftSteps(e.target.value)}
                    onBlur={handleSaveSteps}
                    className="w-24 text-center bg-[#F0F0F0] dark:bg-[#262626] border border-[#D4D4D4] dark:border-[#404040] rounded-lg px-2 py-2 text-[#171717] dark:text-[#E5E5E5] outline-none"
                    placeholder="1, 10"
                  />
                </div>
                <p className="text-[11px] text-[#A3A3A3] mt-1">Minutes between re-shows, e.g. "1, 10" means 1 min then 10 min</p>
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">Graduating interval</span>
                  <WheelPicker
                    value={gradInt}
                    options={INTERVAL_OPTIONS}
                    onChange={handleGradIntChange}
                  />
                </div>
                <p className="text-[11px] text-[#A3A3A3] mt-1">Days until a learned card is shown again after you pass all steps</p>
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">Easy interval</span>
                  <WheelPicker
                    value={easyInt}
                    options={INTERVAL_OPTIONS}
                    onChange={handleEasyIntChange}
                  />
                </div>
                <p className="text-[11px] text-[#A3A3A3] mt-1">Days until next review when you press "Easy" on a new card</p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
