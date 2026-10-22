import type { CSSProperties } from 'react';
import './TabBar.css';
import type { LibraryPagePositionProps } from '../types/libraryTools';
import { LIBRARY_SWIPE_SETTLE_MS } from '../lib/librarySwipe';

/** Identify swipeable library pages without a segmented switch.
 * @param props - Current mode and accessible direct navigation callback.
 * @returns Two accessible dots with a restrained traveller following the active drag; no idle motion.
 */
export function TabBar({ mode, onChange, pageProgress, returning = false }: LibraryPagePositionProps) {
  const controlledPosition = mode === 'learn' ? 0 : 1;
  const position = pageProgress !== undefined && Number.isFinite(pageProgress) ? Math.max(0, Math.min(1, pageProgress)) : controlledPosition;
  const travellerOpacity = Math.min(1, position * 8, (1 - position) * 8);
  // Retire the moving paint layer after its fade, rather than retaining an
  // invisible transformed pixel beside the two permanent anchors.
  const showTraveller = returning || (position > 0 && position < 1);
  return <nav className="library-page-position" aria-label={`Library pages, ${mode === 'learn' ? 'Study' : 'Practice'}`}>
    <div className="library-page-dots" data-returning={returning} style={{ '--library-page-progress': position, '--library-traveller-opacity': travellerOpacity, '--library-page-settle-duration': `${LIBRARY_SWIPE_SETTLE_MS}ms` } as CSSProperties}>
      {showTraveller && <span className="library-page-traveller" aria-hidden="true" />}
      <button type="button" aria-label="Study decks" aria-current={mode === 'learn' ? 'page' : undefined} onClick={() => onChange('learn')}><span /></button>
      <button type="button" aria-label="Practice decks" aria-current={mode === 'review' ? 'page' : undefined} onClick={() => onChange('review')}><span /></button>
    </div>
  </nav>;
}
