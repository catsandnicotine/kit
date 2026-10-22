import { useEffect, useRef, useState } from 'react';
import { TabBar } from '../src/components/TabBar';
import type { LibrarySwipeMode } from '../src/types/librarySwipe';
import { LIBRARY_SWIPE_SETTLE_MS } from '../src/lib/librarySwipe';
import '../src/index.css';

/** Inspect the real page dots with local sample positions and no app data.
 * @returns A developer-only marker lifecycle fixture; no deck, history or preference writes.
 */
export function LibraryMarkerStudy() {
  const [mode, setMode] = useState<LibrarySwipeMode>('learn');
  const [progress, setProgress] = useState(0);
  const [returning, setReturning] = useState(false);
  const [previewMotion, setPreviewMotion] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const midSwipe = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = undefined;
    setReturning(false);
    setProgress(0.5);
  };
  const settle = (next: LibrarySwipeMode) => {
    if (timer.current) clearTimeout(timer.current);
    setMode(next);
    setProgress(next === 'learn' ? 0 : 1);
    setReturning(true);
    timer.current = setTimeout(() => { timer.current = undefined; setReturning(false); }, LIBRARY_SWIPE_SETTLE_MS);
  };
  return <main className={`library-marker-study ${previewMotion ? 'preview-motion' : ''}`}>
    <style>{`
      body { margin:0; background:#000; color:#e5e5e5; font-family:-apple-system,BlinkMacSystemFont,sans-serif; }
      .library-marker-study { max-width:500px; margin:0 auto; padding:40px 24px; }
      .library-marker-study h1 { font-size:21px; font-weight:500; margin:0 0 18px; }
      .library-marker-sample { display:grid; place-items:center; min-height:140px; background:#080909; border-radius:18px; }
      .library-marker-study .library-page-position { min-height:44px; padding:0; }
      .library-marker-actions { display:flex; flex-wrap:wrap; gap:10px; margin:20px 0; }
      .library-marker-actions button { min-height:44px; padding:10px 14px; background:#202020; border:0; border-radius:12px; color:inherit; font-size:14px; }
      .library-marker-study label { display:flex; align-items:center; gap:8px; font-size:13px; line-height:1.5; }
      .library-marker-state { font:13px/1.6 ui-monospace,monospace; opacity:.6; }
      .library-marker-study.preview-motion .library-page-traveller { display:block; }
      .library-marker-study.preview-motion .library-page-dots[data-returning="true"] .library-page-traveller { transition:left var(--library-page-settle-duration) cubic-bezier(.2,.7,.3,1),opacity var(--library-page-settle-duration) ease-out; }
    `}</style>
    <h1>Page marker</h1>
    <section className="library-marker-sample" aria-label="Sample library page controls">
      <TabBar mode={mode} onChange={settle} pageProgress={progress} returning={returning} />
    </section>
    <div className="library-marker-actions">
      <button type="button" onClick={midSwipe}>Mid swipe</button>
      <button type="button" onClick={() => settle('learn')}>Settle at Study</button>
      <button type="button" onClick={() => settle('review')}>Settle at Practice</button>
    </div>
    <label><input type="checkbox" checked={previewMotion} onChange={event => setPreviewMotion(event.target.checked)} />Preview motion here, including with Reduce Motion</label>
    <p className="library-marker-state" role="status">{returning ? 'Returning' : progress > 0 && progress < 1 ? 'Mid swipe' : 'Settled'} · {mode === 'learn' ? 'Study' : 'Practice'} · position {progress}</p>
  </main>;
}
