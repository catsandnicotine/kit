import type { StudyProgress } from '../types/studyProgress';

/** Quiet session progress, with repeats represented as unfinished work.
 * @param props.progress - Distinct cards cleared and still pending this session.
 * @returns A labelled, accessible progress indicator with exact remaining count.
 */
export function StudyProgressBar({ progress }: { progress: StudyProgress }) {
  const { completed, total, remaining, percent } = progress;
  return <div className="study-progress">
    <div className="study-progress-counts" aria-hidden="true">
      <span><strong>{completed}</strong><span className="study-progress-divider"> / </span>{total}<span className="study-progress-caption"> done</span></span>
      <span><strong>{remaining}</strong> left</span>
    </div>
    <div className="deck-progress-track" role="progressbar" aria-label="Session progress" aria-valuemin={0} aria-valuemax={total || 1} aria-valuenow={completed} aria-valuetext={`${completed} of ${total} cards cleared for this session; ${remaining} left`}>
      <div className="deck-progress-fill" style={{ width: `${percent}%` }} aria-hidden="true" />
    </div>
  </div>;
}
