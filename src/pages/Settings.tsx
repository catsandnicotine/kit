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
import { UiIcon } from '../components/UiIcon';
import './Settings.css';
import { useHelpDocument } from '../hooks/useHelpDocument';
import type { HelpPage } from '../types/helpDocument';

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
  const [helpPage, setHelpPage] = useState<HelpPage | null>(null);
  const help = useHelpDocument(helpPage);
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

  if (helpPage) return <main className="kit-settings h-[100dvh] flex flex-col bg-[var(--kit-bg)] text-[#1c1c1e] dark:text-[#E5E5E5]">
    <header className="kit-page-header"><button type="button" className="kit-icon-button" aria-label="Back to settings" onClick={() => { hapticTap(); setHelpPage(null); }}><UiIcon name="back" /></button><h1 className="text-sm font-semibold">{helpPage === 'privacy' ? 'Privacy' : 'Support'}</h1></header>
    <section className="kit-help-copy" aria-label={helpPage === 'privacy' ? 'Privacy policy' : 'Kit support'}>
      {help.status === 'ready' ? <div dangerouslySetInnerHTML={{ __html:help.html }} />
        : help.status === 'error' ? <p role="alert">Could not open this page. Email <a href="mailto:jikelvin9@gmail.com">jikelvin9@gmail.com</a> for help.</p>
          : <p role="status">Opening…</p>}
    </section>
  </main>;

  return (
    <main className="kit-settings min-h-[100dvh] bg-[var(--kit-bg)] text-[#1c1c1e] dark:text-[#E5E5E5]">
      <header className="kit-page-header">
        <button type="button" className="kit-icon-button" aria-label="Back" onClick={() => { hapticTap(); onBack(); }}>
          <UiIcon name="back" />
        </button>
        <h1 className="text-sm font-semibold">Settings</h1>
      </header>
      <div className="kit-settings-body">
        <section className="kit-settings-group" aria-label="Display">
          <div className="kit-settings-row kit-settings-appearance">
            <span id="kit-appearance-label">Appearance</span>
            <div className="kit-settings-themes" role="group" aria-labelledby="kit-appearance-label">
            {(['light', 'dark', 'black'] as Theme[]).map(option => (
              <button key={option} type="button" aria-pressed={theme === option} onClick={() => { hapticTap(); setTheme(option); }} className={`kit-settings-theme${theme === option ? ' is-selected' : ''}`}>
                {option}
              </button>
            ))}
            </div>
          </div>
          <label className="kit-settings-row cursor-pointer">
            <span>Session timer</span>
            <input type="checkbox" role="switch" checked={showTimer} className="kit-switch" onChange={event => {
              hapticTap(); setShowTimer(event.target.checked);
              try { localStorage.setItem('kit_show_timer', String(event.target.checked)); } catch { /* preference unavailable */ }
            }} />
          </label>
        </section>
        <div className="kit-settings-group">
        <details className="kit-settings-disclosure">
          <summary className="kit-settings-row cursor-pointer"><span>Study defaults</span><span className="kit-settings-chevron"><UiIcon name="down" /></span></summary>
          <div className="kit-settings-details">
            <label className="kit-settings-retention"><span className="flex justify-between">Retention <strong>{Math.round(preferences.desiredRetention * 100)}%</strong></span>
              <input type="range" min="70" max="99" value={Math.round(preferences.desiredRetention * 100)} onChange={event => setPreferences(p => ({ ...p, desiredRetention: Number(event.target.value) / 100 }))} />
            </label>
            <label className="kit-settings-field"><span>Learning steps · minutes</span><input aria-label="Learning steps in minutes" value={steps} onChange={event => setSteps(event.target.value)} onBlur={() => {
              const parsed = steps.split(/[,\s]+/).map(Number).filter(n => Number.isFinite(n) && n > 0).map(Math.round).slice(0, 8);
              const next = parsed.length ? parsed : preferences.againSteps;
              setSteps(next.join(', ')); setPreferences(p => ({ ...p, againSteps: next }));
            }} /></label>
            <label className="kit-settings-field"><span>First review · days</span><input type="number" min="1" max="365" value={preferences.graduatingInterval} onChange={event => { const n = Number(event.target.value); if (n > 0) setPreferences(p => ({ ...p, graduatingInterval: Math.round(n) })); }} /></label>
            <label className="kit-settings-field"><span>Easy review · days</span><input type="number" min="1" max="365" value={preferences.easyInterval} onChange={event => { const n = Number(event.target.value); if (n > 0) setPreferences(p => ({ ...p, easyInterval: Math.round(n) })); }} /></label>
            <p className="kit-settings-note">Used for new decks. Existing decks keep their settings.</p>
            <button type="button" onClick={() => void apply()} disabled={!deckManager || applyState === 'working'} className="kit-secondary-button kit-settings-action">
              {applyState === 'working' ? 'Applying…' : applyState === 'done' ? 'Applied' : 'Apply to existing decks'}
            </button>
            {applyState === 'error' && <p role="alert" className="text-xs text-red-600">{message}</p>}
          </div>
        </details>
        <details className="kit-settings-disclosure" open={scrollTo === 'icloud-sync' ? true : undefined}>
          <summary className="kit-settings-row cursor-pointer"><span>Storage & sync</span><span className="kit-settings-chevron"><UiIcon name="down" /></span></summary>
          <div className="kit-settings-details">
            <div className="kit-settings-status"><span>iCloud Drive</span><span>{icloudAvailability === 'available' ? 'Available' : icloudAvailability === 'checking' ? 'Checking…' : 'Unavailable'}</span></div>
            {lastSyncedAt && <div className="kit-settings-status"><span>Last checked</span><span>{new Date(lastSyncedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span></div>}
            <p className="kit-settings-note">Saved on this device. iCloud Drive uses your Apple account and storage.</p>
            <button type="button" disabled={checking} className="kit-secondary-button kit-settings-action" onClick={async () => { hapticTap(); setChecking(true); try { await onSync(); } finally { setChecking(false); } }}>{checking ? 'Checking…' : 'Check sync'}</button>
          </div>
        </details>
        </div>
        <section className="kit-settings-group" aria-label="Help">
          <button type="button" className="kit-settings-row" onClick={() => { hapticTap(); setHelpPage('support'); }}><span>Support</span><span className="kit-settings-link-arrow" aria-hidden="true">›</span></button>
          <button type="button" className="kit-settings-row" onClick={() => { hapticTap(); setHelpPage('privacy'); }}><span>Privacy</span><span className="kit-settings-link-arrow" aria-hidden="true">›</span></button>
        </section>
        <div className="kit-settings-footer">
          <button type="button" disabled={!deckManager || paintings.busy} onClick={() => void paintings.tapVersion()} className="kit-settings-version" aria-label={`Kit ${version}, build ${build}`}>
            Kit {version} · {build}
          </button>
          {paintings.busy && <p role="status" className="text-xs text-[#777] dark:text-[#aaa]">Opening paintings…</p>}
          {paintings.error && <p role="alert" className="text-xs text-red-600">{paintings.error}</p>}
        </div>
      </div>
    </main>
  );
}
