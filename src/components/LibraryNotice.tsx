import type { LibraryNotice as Notice } from '../types/libraryNotice';
import { UiIcon } from './UiIcon';
import { useNoticeAutoDismiss } from '../hooks/useNoticeAutoDismiss';

/** Keep an operation's outcome visible below the library toolbar.
 * @param props.notice - Friendly summary and optional original diagnostics.
 * @param props.onDismiss - Dismiss a finished operation; busy/fatal states stay visible.
 * @returns An in-flow notice with diagnostics available only on request.
 */
export function LibraryNotice({ notice, onDismiss }: { notice: Notice; onDismiss?: () => void }) {
  const autoDismiss = useNoticeAutoDismiss({
    identity: JSON.stringify([notice.source, notice.tone, notice.title, notice.message, notice.details]),
    visible: true,
    delayMs: !onDismiss || notice.tone === 'progress' ? null : notice.tone === 'error' ? 9000 : 4000,
    onDismiss,
  });
  return <section className={`library-notice library-notice--${notice.tone}`} aria-label="Library activity" {...autoDismiss.events}>
    <div className="library-notice-main">
      <svg className="library-notice-symbol" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {notice.tone === 'success' ? <path d="m5 12 4 4L19 6" /> : notice.tone === 'error' ? <><circle cx="12" cy="12" r="9" /><path d="M12 7v6m0 4h.01" /></> : <><path d="M4 12a8 8 0 0 1 14-5m2 5a8 8 0 0 1-14 5M18 3v4h-4M6 21v-4h4" /></>}
      </svg>
      <div className="library-notice-copy" role={notice.tone === 'error' ? 'alert' : 'status'}>
        <p className="library-notice-title">{notice.title}</p>
        {notice.message && <p className="library-notice-message">{notice.message}</p>}
      </div>
      {onDismiss && <button type="button" className="kit-icon-button library-notice-dismiss" aria-label="Dismiss library message" onClick={onDismiss}><UiIcon name="close" /></button>}
    </div>
    {notice.details && <details className="library-notice-details" onToggle={event => autoDismiss.setDetailsOpen(event.currentTarget.open)}><summary>Details</summary><pre>{notice.details}</pre></details>}
  </section>;
}
