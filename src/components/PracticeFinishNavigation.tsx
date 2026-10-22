import type { PracticeFinishNavigationProps } from '../types/practiceNavigation';
import { PracticeNavigationButton } from './PracticeNavigationButton';

/** Keep the same corner targets available after reaching the end of practice.
 * @param props - Previous-card availability and the existing session callback.
 * @returns A safe-area footer; Next remains visible and disabled at the end.
 */
export function PracticeFinishNavigation({ canPrevious, onPrevious }: PracticeFinishNavigationProps) {
  return <footer className="practice-finish-navigation" aria-label="Practice navigation">
    <div className="study-tools">
      <span className="study-tools-slot"><PracticeNavigationButton direction="previous" disabled={!canPrevious} onNavigate={onPrevious} /></span>
      <span aria-hidden="true" />
      <span className="study-tools-slot"><PracticeNavigationButton direction="next" disabled onNavigate={() => undefined} /></span>
    </div>
  </footer>;
}
