import { DeckName } from '../components/DeckName';
/**
 * DeckSettings page — per-deck configuration with plain-English descriptions.
 *
 * Uses native <select> elements for numeric values which show the iOS
 * scroll wheel picker.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Database } from 'sql.js';
import {
  getDeckSettings,
  setNewCardsPerDay,
  setDeckLearningSteps,
  setDeckSetting,
  setDesiredRetention as saveDesiredRetention,
  type DeckSettings as DeckSettingsType,
} from '../lib/db/queries';
import { persistDatabase } from '../hooks/useDatabase';
import { hapticTap } from '../lib/platform/haptics';
import type { EditOp } from '../lib/sync/types';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface DeckSettingsProps {
  db: Database | null;
  deckId: string;
  deckName: string;
  onBack: () => void;
  /** Callback to emit sync edit operations (new per-deck architecture). */
  onSyncEdit?: ((ops: EditOp[]) => void) | undefined;
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
  label,
}: {
  value: number;
  options: number[];
  onChange: (v: number) => void;
  suffix?: string;
  label?: string;
}) {
  // Imported/older decks may contain a valid value outside today's presets.
  // Keep that value visible instead of letting <select> misleadingly display
  // its first option while a different number remains stored.
  const visibleOptions = options.includes(value)
    ? options
    : [...options, value].sort((a, b) => a - b);

  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => { hapticTap(); onChange(Number(e.target.value)); }}
      className="bg-[#F0F0F0] dark:bg-[#262626] rounded-lg px-3 py-2 text-sm font-semibold text-[#1c1c1e] dark:text-[#E5E5E5] tabular-nums outline-none appearance-none text-center min-w-[4.5rem]"
    >
      {visibleOptions.map((n) => (
        <option key={n} value={n}>{n}{suffix ?? ''}</option>
      ))}
    </select>
  );
}

/** Numeric text input styled to match WheelPicker — shows numeric keyboard on iOS. */
function NumberInput({
  value,
  min,
  max,
  onChange,
  suffix,
  label,
}: {
  value: number;
  min?: number;
  max?: number;
  onChange: (v: number) => void;
  suffix?: string;
  label?: string;
}) {
  const [draft, setDraft] = useState(String(value));
  // Keep draft in sync when value changes externally
  useEffect(() => { setDraft(String(value)); }, [value]);

  const commit = () => {
    const n = parseInt(draft, 10);
    if (!isNaN(n)) {
      const clamped = Math.max(min ?? 0, Math.min(max ?? 999999, n));
      onChange(clamped);
      setDraft(String(clamped));
    } else {
      setDraft(String(value));
    }
  };

  return (
    <div className="flex items-center gap-1 bg-[#F0F0F0] dark:bg-[#262626] rounded-lg px-3 py-2 min-w-[4.5rem]">
      <input
        type="number"
        aria-label={label}
        inputMode="numeric"
        value={draft}
        min={min}
        max={max}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onFocus={() => hapticTap()}
        onKeyDown={(e) => { if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); } }}
        className="w-full text-center text-sm font-semibold tabular-nums bg-transparent outline-none text-[#1c1c1e] dark:text-[#E5E5E5] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      {suffix && <span className="text-sm font-semibold text-[#C4C4C4] shrink-0">{suffix}</span>}
    </div>
  );
}

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
          className="flex items-center gap-1 bg-[#F0F0F0] dark:bg-[#262626] rounded-lg px-2.5 py-1.5"
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
          className="w-16 text-center bg-[#F0F0F0] dark:bg-[#262626] rounded-lg px-2 py-1.5 text-sm font-semibold outline-none"
          placeholder="min"
          min={1}
        />
      ) : (
        <button
          onClick={() => { hapticTap(); setIsAdding(true); }}
          className="flex items-center justify-center w-8 h-8 rounded-lg text-[#C4C4C4] text-xl leading-none"
        >
          +
        </button>
      )}
    </div>
  );
}

/** A settings row with label and right-side control. Optional ⓘ tooltip or inline description. */
function SettingRow({
  label,
  description,
  tooltip,
  children,
}: {
  label: string;
  description?: string;
  tooltip?: string;
  children: React.ReactNode;
}) {
  const [showTooltip, setShowTooltip] = useState(false);
  const help = tooltip ?? description;
  return (
    <div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <span className="text-sm font-medium">{label}</span>
          {help && (
            <button
              onClick={() => { hapticTap(); setShowTooltip(v => !v); }}
              aria-label={`${label}: help`} title={`${label}: help`}
              className="kit-icon-button text-[#999]"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 16v-4M12 8h.01" />
              </svg>
            </button>
          )}
        </div>
        {children}
      </div>
      {help && showTooltip && <p className="text-xs text-[#999] mt-2 leading-relaxed">{help}</p>}
    </div>
  );
}

/** Section card with header and description. */
function Section({
  title,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return <details className="deck-settings-section" open={title === 'Daily Limits' ? true : undefined}>
    <summary>{title}<span aria-hidden="true">⌄</span></summary>
    <div className="flex flex-col gap-4 pt-4">{children}</div>
  </details>;
}

// Pre-generate option arrays
const DAILY_LIMIT_OPTIONS = Array.from({ length: 101 }, (_, i) => i * 5); // 0–500
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
export default function DeckSettings({ db, deckId, deckName, onBack, onSyncEdit }: DeckSettingsProps) {
  const [settings, setSettings] = useState<DeckSettingsType | null>(null);
  const [limit, setLimit] = useState(20);
  const [maxReviews, setMaxReviews] = useState(200);
  const [gradInt, setGradInt] = useState(1);
  const [easyInt, setEasyInt] = useState(4);
  const [maxInterval, setMaxInterval] = useState(365);
  const [leechThreshold, setLeechThreshold] = useState(8);
  const [desiredRetention, setDesiredRetention] = useState(0.9);
  const [steps, setSteps] = useState<number[]>([1, 10]);

  useEffect(() => {
    if (!db) return;
    const settingsResult = getDeckSettings(db, deckId);
    if (settingsResult.success) {
      const d = settingsResult.data;
      setSettings(d);
      setLimit(d.newCardsPerDay);
      setMaxReviews(d.maxReviewsPerDay);
      setSteps(d.againSteps);
      setGradInt(d.graduatingInterval);
      setEasyInt(d.easyInterval);
      setMaxInterval(d.maxInterval);
      setLeechThreshold(d.leechThreshold);
      setDesiredRetention(d.desiredRetention);
    }
  }, [db, deckId]);

  /** Persist after a settings change — emits sync edit or falls back to old path. */
  const persistSettingsChange = useCallback((partial: Partial<DeckSettingsType>) => {
    if (onSyncEdit) {
      onSyncEdit([{ type: 'deck_settings', settings: partial }]);
    } else {
      persistDatabase();
    }
  }, [onSyncEdit]);

  /** Save all learning-related settings at once. */
  const saveLearningSettings = useCallback((
    newSteps: number[],
    grad: number,
    easy: number,
  ) => {
    if (!db || newSteps.length === 0) return;
    const result = setDeckLearningSteps(db, deckId, newSteps, grad, easy);
    if (result.success) {
      setSettings(prev => prev ? { ...prev, againSteps: newSteps, graduatingInterval: grad, easyInterval: easy } : prev);
      persistSettingsChange({ againSteps: newSteps, graduatingInterval: grad, easyInterval: easy });
    }
  }, [db, deckId, persistSettingsChange]);

  const handleSaveLimit = useCallback((val: number) => {
    if (!db) return;
    setLimit(val);
    const result = setNewCardsPerDay(db, deckId, val);
    if (result.success) {
      setSettings(prev => prev ? { ...prev, newCardsPerDay: val } : prev);
      persistSettingsChange({ newCardsPerDay: val });
    }
  }, [db, deckId, persistSettingsChange]);

  const handleSaveMaxReviews = useCallback((val: number) => {
    if (!db) return;
    setMaxReviews(val);
    const result = setDeckSetting(db, deckId, 'max_reviews_per_day', val);
    if (result.success) {
      setSettings(prev => prev ? { ...prev, maxReviewsPerDay: val } : prev);
      persistSettingsChange({ maxReviewsPerDay: val });
    }
  }, [db, deckId, persistSettingsChange]);

  const handleSaveMaxInterval = useCallback((val: number) => {
    if (!db) return;
    setMaxInterval(val);
    const result = setDeckSetting(db, deckId, 'max_interval', val);
    if (result.success) {
      setSettings(prev => prev ? { ...prev, maxInterval: val } : prev);
      persistSettingsChange({ maxInterval: val });
    }
  }, [db, deckId, persistSettingsChange]);

  const handleSaveLeechThreshold = useCallback((val: number) => {
    if (!db) return;
    setLeechThreshold(val);
    const result = setDeckSetting(db, deckId, 'leech_threshold', val);
    if (result.success) {
      setSettings(prev => prev ? { ...prev, leechThreshold: val } : prev);
      persistSettingsChange({ leechThreshold: val });
    }
  }, [db, deckId, persistSettingsChange]);

  const handleSaveRetention = useCallback((val: number) => {
    if (!db) return;
    setDesiredRetention(val);
    const result = saveDesiredRetention(db, deckId, val);
    if (result.success) {
      setSettings(prev => prev ? { ...prev, desiredRetention: val } : prev);
      persistSettingsChange({ desiredRetention: val });
    }
  }, [db, deckId, persistSettingsChange]);

  if (!settings) {
    return (
      <div className="min-h-[100dvh] flex flex-col bg-[var(--kit-bg)] text-[#1c1c1e] dark:text-[#E5E5E5]">
        <header
          className="flex items-center pb-3 border-b border-[#E5E5E5] dark:border-[#262626] shrink-0"
          style={{
            paddingTop: 'calc(env(safe-area-inset-top) + 0.75rem)',
            paddingLeft: 'max(1rem, env(safe-area-inset-left))',
            paddingRight: 'max(1rem, env(safe-area-inset-right))',
          }}
        >
          <button onClick={() => { hapticTap(); onBack(); }} className="p-2 -ml-2 text-[#C4C4C4] hover:text-[#1c1c1e] dark:hover:text-[#E5E5E5] transition-colors shrink-0 mr-1" aria-label="Back"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg></button>
          <DeckName name={deckName} className="text-base font-bold" />
        </header>
        <div className="flex items-center justify-center py-12">
          <p className="text-sm text-[#C4C4C4]">Loading…</p>
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
          paddingTop: 'calc(env(safe-area-inset-top) + 0.75rem)',
          paddingLeft: 'max(1rem, env(safe-area-inset-left))',
          paddingRight: 'max(1rem, env(safe-area-inset-right))',
        }}
      >
        <button onClick={() => { hapticTap(); onBack(); }} className="p-2 -ml-2 text-[#C4C4C4] hover:text-[#1c1c1e] dark:hover:text-[#E5E5E5] transition-colors shrink-0 mr-1" aria-label="Back"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg></button>
        <div className="min-w-0"><DeckName name={deckName} className="text-sm font-semibold" /><span className="text-xs text-[#999]">Study settings</span></div>
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
        >
          <SettingRow
            label="New cards per day"
            description="How many unseen cards to introduce each day. Start with 20 and adjust based on how you feel."
          >
            <WheelPicker label="New cards per day" value={limit} options={DAILY_LIMIT_OPTIONS} onChange={handleSaveLimit} />
          </SettingRow>

          <SettingRow
            label="Reviews per session"
            tooltip="Cap on review cards per session. If you fall behind, this prevents an overwhelming pile of reviews. Learning cards always show regardless."
          >
            <NumberInput
              label="Reviews per session"
              value={maxReviews}
              min={1}
              max={9999}
              onChange={handleSaveMaxReviews}
            />
          </SettingRow>

        </Section>

        {/* Learning Steps */}
        <Section
          title="Learning Steps"
        >
          <div>
            <span className="text-sm font-medium">Practice intervals</span>
            <p className="text-xs text-[#999]">Minutes between attempts</p>
            <StepsEditor
              steps={steps}
              onChange={(s) => { setSteps(s); saveLearningSettings(s, gradInt, easyInt); }}
            />
          </div>

          <SettingRow
            label="First review after learning"
            description="Once you pass all practice steps, how many days until the card comes back for its first real review."
          >
            <WheelPicker
              value={gradInt}
              options={INTERVAL_OPTIONS}
              onChange={(v) => { setGradInt(v); saveLearningSettings(steps, v, easyInt); }}
            />
          </SettingRow>

          <SettingRow
            label="Easy interval"
            tooltip='Pressing Easy on a new card skips all practice steps and schedules it for first review after this many days.'
          >
            <WheelPicker
              value={easyInt}
              options={INTERVAL_OPTIONS}
              onChange={(v) => { setEasyInt(v); saveLearningSettings(steps, gradInt, v); }}
            />
          </SettingRow>
        </Section>

        {/* Scheduling */}
        <Section
          title="Scheduling"
        >
          <SettingRow
            label="Target retention"
            tooltip="How often you should remember a card when it comes due. Higher = more frequent reviews but better memory. 90% works for most people."
          >
            <div className="flex flex-col items-end gap-1 w-32">
              <span className="text-sm font-semibold tabular-nums">
                {Math.round(desiredRetention * 100)}%
              </span>
              <div onTouchMove={e => e.stopPropagation()}>
                <input
                  type="range"
                  aria-label="Target retention"
                  min={70}
                  max={99}
                  step={1}
                  value={Math.round(desiredRetention * 100)}
                  onInput={e => handleSaveRetention(Number((e.target as HTMLInputElement).value) / 100)}
                  onChange={e => handleSaveRetention(Number(e.target.value) / 100)}
                  className="w-full accent-text-light dark:accent-text-dark"
                  style={{ touchAction: 'none' }}
                />
              </div>
              <div className="flex justify-between w-full text-xs text-text-muted">
                <span>70%</span>
                <span>99%</span>
              </div>
            </div>
          </SettingRow>

          <SettingRow
            label="Maximum wait between reviews"
            tooltip="The longest a card can go before you see it again. Shorter = more reviews but better retention. 365 days works for most people."
          >
            <WheelPicker
              label="Maximum wait in days"
              value={maxInterval}
              options={MAX_INTERVAL_OPTIONS}
              onChange={handleSaveMaxInterval}
            />
          </SettingRow>

          <SettingRow
            label="Trouble card detection"
            tooltip="If you get a card wrong this many times, Kit will suspend it as a 'leech'. These cards usually need to be rewritten. Set to 0 to disable."
          >
            <WheelPicker
              label="Wrong attempts before suspension"
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
