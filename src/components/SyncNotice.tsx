import type { ConnectionState } from '../types/connection';
import { useNoticeAutoDismiss } from '../hooks/useNoticeAutoDismiss';
import { SyncPausedGlyph } from './SyncPausedGlyph';

interface SyncNoticeProps {
  visible: boolean;
  kind: ConnectionState | 'syncing';
  progress: { completed: number; total: number } | null;
  onDismiss: () => void;
}

/**
 * Render an expanding status bar below the Home toolbar.
 * @param props - Notice visibility, real activity, and dismissal action.
 * @returns A status row that occupies layout space while visible.
 */
export function SyncNotice({ visible, kind, progress, onDismiss }: SyncNoticeProps) {
  const autoDismiss = useNoticeAutoDismiss({ identity: kind, visible, delayMs: kind === 'syncing' || kind === 'checking' ? null : kind === 'paused' ? 9000 : 4000, onDismiss });
  const title = kind === 'offline' ? 'Offline' : kind === 'paused' ? 'Sync paused' : 'Online';
  const detail = kind === 'offline' ? 'Saved here' : kind === 'paused' ? 'Saved here · check sync'
    : kind === 'syncing' ? `Syncing${progress ? ` · ${progress.completed}/${progress.total} decks` : ''}` : 'Connected';
  return <div className={`sync-notice-region ${visible ? 'sync-notice-region--visible' : ''}`} inert={!visible}>
    <div className="sync-notice-clip">
      <aside className={`sync-notice sync-notice--${kind}`} aria-label="Connection status" {...autoDismiss.events}>
        <div className="sync-notice-copy" role="status" aria-live="polite">
          {kind === 'paused' ? <SyncPausedGlyph /> : <svg className="sync-notice-icon" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
            {kind === 'offline' ? <><path d="m3 3 18 18M3 9a16 16 0 0 1 3-2M10 5a16 16 0 0 1 11 4M6 13l1.5-1M15 12l3 1M9.5 17a4 4 0 0 1 5 0" /><circle cx="12" cy="21" r="1.4" fill="currentColor" stroke="none" /></>
              : <><path d="M3 8a16 16 0 0 1 18 0M6 12a10 10 0 0 1 12 0M9.5 16a4 4 0 0 1 5 0" /><circle cx="12" cy="21" r="1.7" fill="currentColor" stroke="none" /></>}
          </svg>}
          <div><p className="sync-notice-title">{title}</p><p className="sync-notice-detail">{detail}</p></div>
        </div>
        <button type="button" aria-label="Dismiss connection status" tabIndex={visible ? 0 : -1} onClick={onDismiss} className="sync-notice-dismiss">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" /></svg>
        </button>
        {kind === 'syncing' && progress && progress.total > 0 && <span className="sync-notice-progress" style={{ width: `${100 * progress.completed / progress.total}%` }} />}
      </aside>
    </div>
  </div>;
}
