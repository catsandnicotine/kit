import { useCallback, useEffect, useState } from 'react';
import type { Theme } from '../types';
import { useTheme } from '../hooks/useTheme';
import { useDeviceInfo } from '../hooks/useDeviceInfo';
import type { UseDeckManagerReturn } from '../hooks/useDeckManager';
import type { ICloudAvailability } from '../hooks/useICloudAvailability';
import { hapticTap } from '../lib/platform/haptics';
import { applyLearningStepsToAllDecks, applyRetentionToAllDecks } from '../lib/db/queries';
import { loadStudyPreferences, saveStudyPreferences } from '../lib/studyPreferences';
import { useJesusPaintingDeck } from '../hooks/useJesusPaintingDeck';

interface SettingsProps {
  deckManager: UseDeckManagerReturn | null;
  lastSyncedAt: number | null;
  icloudAvailability: ICloudAvailability;
  onBack: () => void;
  onSync: () => Promise<void>;
  onOpenDeck: (deckId: string, deckName: string) => void;
  scrollTo?: string | undefined;
}

/** App preferences, with scheduling and storage details available on demand. */
export default function Settings({ deckManager, lastSyncedAt, icloudAvailability, onBack, onSync, onOpenDeck, scrollTo }: SettingsProps) {
  const { theme, setTheme } = useTheme();
  const { version, build } = useDeviceInfo();
  const paintings = useJesusPaintingDeck(deckManager, onOpenDeck);
  const [preferences, setPreferences] = useState(loadStudyPreferences);
  const [steps, setSteps] = useState(() => preferences.againSteps.join(', '));
  const [showTimer, setShowTimer] = useState(() => {
    try { return localStorage.getItem('kit_show_timer') !== 'false'; } catch { return true; }
  });
  const [applyState, setApplyState] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [checking, setChecking] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  useEffect(() => { saveStudyPreferences(preferences); }, [preferences]);

  const apply = useCallback(async () => {
    if (!deckManager || applyState === 'working') return;
    hapticTap();
    setApplyState('working');
    try {
      for (const entry of deckManager.deckEntries) {
        const cached = deckManager.getCachedDeckDb(entry.deckId);
        const db = cached ?? await deckManager.openDeckDb(entry.deckId);
        if (!db) throw new Error(`Could not open ${entry.name}.`);
        try {
          const learning = applyLearningStepsToAllDecks(db, preferences.againSteps, preferences.graduatingInterval, preferences.easyInterval);
          const retention = applyRetentionToAllDecks(db, preferences.desiredRetention);
          if (!learning.success) throw new Error(learning.error);
          if (!retention.success) throw new Error(retention.error);
          const saved = await deckManager.writeEdit(entry.deckId, [{ type: 'deck_settings', settings: preferences }]);
          if (!saved) throw new Error(`Could not save ${entry.name}.`);
          await deckManager.compact(entry.deckId);
        } finally { if (!cached) deckManager.closeDeckDb(entry.deckId); }
      }
      setApplyState('done');
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Could not update decks.');
      setApplyState('error');
    }
  }, [deckManager, preferences, applyState]);

  if (showPrivacy) return <main className="h-[100dvh] flex flex-col bg-[var(--kit-bg)] text-[#1c1c1e] dark:text-[#E5E5E5]">
    <header className="kit-page-header"><button type="button" className="kit-icon-button" aria-label="Back to settings" onClick={() => setShowPrivacy(false)}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m15 5-7 7 7 7" /></svg></button><h1 className="text-sm font-semibold">Privacy</h1></header>
    <iframe className="flex-1 w-full border-0" title="Privacy policy" src={`${import.meta.env.BASE_URL}privacy.html`} />
  </main>;

  return (
    <main className="min-h-[100dvh] bg-[var(--kit-bg)] text-[#1c1c1e] dark:text-[#E5E5E5]">
      <header className="kit-page-header">
        <button type="button" className="kit-icon-button" aria-label="Back" onClick={() => { hapticTap(); onBack(); }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m15 5-7 7 7 7" /></svg>
        </button>
        <h1 className="text-sm font-semibold">Settings</h1>
      </header>
      <div className="mx-auto max-w-lg space-y-5 px-5 pb-10 pt-6">
        <section aria-label="Appearance" className="settings-panel">
          <div className="grid grid-cols-3 gap-2" role="group" aria-label="Appearance">
            {(['light', 'dark', 'black'] as Theme[]).map(option => (
              <button key={option} type="button" aria-pressed={theme === option} onClick={() => { hapticTap(); setTheme(option); }} className={`theme-choice ${theme === option ? 'theme-choice--selected' : ''}`}>
                <span aria-hidden="true" className={`theme-swatch theme-swatch--${option}`}><span /><span /><span /></span>
                <span className="theme-choice-caption">{option}
                  <svg className="theme-choice-check" style={{ visibility: theme === option ? 'visible' : 'hidden' }} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m3 8 3 3 7-7" /></svg>
                </span>
              </button>
            ))}
          </div>
        </section>
        <section className="settings-panel">
          <label className="settings-row cursor-pointer">
            <span>Session timer</span>
            <input type="checkbox" role="switch" checked={showTimer} className="kit-switch" onChange={event => {
              hapticTap(); setShowTimer(event.target.checked);
              try { localStorage.setItem('kit_show_timer', String(event.target.checked)); } catch { /* preference unavailable */ }
            }} />
          </label>
        </section>
        <details className="settings-panel">
          <summary className="settings-row cursor-pointer"><span>Study defaults</span><span className="settings-chevron" aria-hidden="true">⌄</span></summary>
          <div className="settings-details space-y-5">
            <label className="block text-xs"><span className="flex justify-between">Retention <strong>{Math.round(preferences.desiredRetention * 100)}%</strong></span>
              <input type="range" min="70" max="99" className="mt-3 w-full accent-current" value={Math.round(preferences.desiredRetention * 100)} onChange={event => setPreferences(p => ({ ...p, desiredRetention: Number(event.target.value) / 100 }))} />
            </label>
            <label className="settings-field"><span>Learning steps · minutes</span><input aria-label="Learning steps in minutes" value={steps} onChange={event => setSteps(event.target.value)} onBlur={() => {
              const parsed = steps.split(/[,\s]+/).map(Number).filter(n => Number.isFinite(n) && n > 0).map(Math.round).slice(0, 8);
              const next = parsed.length ? parsed : preferences.againSteps;
              setSteps(next.join(', ')); setPreferences(p => ({ ...p, againSteps: next }));
            }} /></label>
            <label className="settings-field"><span>First review · days</span><input type="number" min="1" max="365" value={preferences.graduatingInterval} onChange={event => { const n = Number(event.target.value); if (n > 0) setPreferences(p => ({ ...p, graduatingInterval: Math.round(n) })); }} /></label>
            <label className="settings-field"><span>Easy review · days</span><input type="number" min="1" max="365" value={preferences.easyInterval} onChange={event => { const n = Number(event.target.value); if (n > 0) setPreferences(p => ({ ...p, easyInterval: Math.round(n) })); }} /></label>
            <p className="text-[11px] text-[#777] dark:text-[#aaa]">Used for new decks. Existing decks keep their settings.</p>
            <button type="button" onClick={() => void apply()} disabled={!deckManager || applyState === 'working'} className="kit-secondary-button w-full">
              {applyState === 'working' ? 'Applying…' : applyState === 'done' ? 'Applied' : 'Apply to existing decks'}
            </button>
            {applyState === 'error' && <p role="alert" className="text-xs text-red-600">{message}</p>}
          </div>
        </details>
        <details className="settings-panel" open={scrollTo === 'icloud-sync' ? true : undefined}>
          <summary className="settings-row cursor-pointer"><span>Storage & sync</span><span className="settings-chevron" aria-hidden="true">⌄</span></summary>
          <div className="settings-details space-y-4 text-xs">
            <div className="flex justify-between"><span>iCloud Drive</span><span>{icloudAvailability === 'available' ? 'Available' : icloudAvailability === 'checking' ? 'Checking…' : 'Unavailable'}</span></div>
            {lastSyncedAt && <div className="flex justify-between"><span>Last checked</span><span>{new Date(lastSyncedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span></div>}
            <p className="text-[11px] text-[#777] dark:text-[#aaa]">Saved on this device. iCloud Drive uses your Apple account and storage.</p>
            <button type="button" disabled={checking} className="kit-secondary-button w-full" onClick={async () => { hapticTap(); setChecking(true); try { await onSync(); } finally { setChecking(false); } }}>{checking ? 'Checking…' : 'Check sync'}</button>
          </div>
        </details>
        <section className="settings-panel">
          <a href="mailto:jikelvin9@gmail.com" className="settings-row" onClick={() => hapticTap()}><span>Support</span><span aria-hidden="true">↗</span></a>
          <button type="button" className="settings-row w-full" onClick={() => { hapticTap(); setShowPrivacy(true); }}><span>Privacy</span><span aria-hidden="true">›</span></button>
        </section>
        <div className="text-center">
          <button type="button" disabled={!deckManager || paintings.busy} onClick={() => void paintings.tapVersion()} className="min-h-11 px-4 text-[10px] text-[#888] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" aria-label={`Kit ${version}, build ${build}`}>
            Kit {version} · {build}
          </button>
          {paintings.busy && <p role="status" className="text-xs text-[#777] dark:text-[#aaa]">Opening paintings…</p>}
          {paintings.error && <p role="alert" className="text-xs text-red-600">{paintings.error}</p>}
        </div>
      </div>
    </main>
  );
}
