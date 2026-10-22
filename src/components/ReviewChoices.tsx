import { RatingGlyph } from './RatingGlyph';

/**
 * Show the two physical-card decisions used by an unscored review.
 * @param props.onRepeat - Return the current card to the active pile.
 * @param props.onPutAside - Set the current card aside for this session.
 * @param props.selected - Choice receiving the brief pixel feedback.
 * @param props.pending - Guard all session controls until the choice commits.
 * @returns Two large card-shaped controls with accessible action names.
 */
export function ReviewChoices({ onRepeat, onPutAside, selected, pending }: { onRepeat: () => void; onPutAside: () => void; selected: 'again' | 'aside' | null; pending: boolean }) {
  return <div className="review-choices" role="group" aria-label="Review this card">
    <button type="button" disabled={pending} onClick={onRepeat} className={`review-choice rating-control--again ${selected === 'again' ? 'is-feedback' : ''}`} aria-label="Again. Return this card to the pile.">
      <RatingGlyph rating="again" />
      <span className="study-action-caption">Again</span>
    </button>
    <button type="button" disabled={pending} onClick={onPutAside} className={`review-choice rating-control--good ${selected === 'aside' ? 'is-feedback' : ''}`} aria-label="Put aside. Finished with this card for this session.">
      <RatingGlyph rating="good" />
      <span className="study-action-caption">Put aside</span>
    </button>
  </div>;
}
