import { CardSeenCount } from './CardSeenCount';
import type { CardFaceIndicatorProps } from '../types/studyUi';

/** Select either side of the current card without advancing the study queue.
 * @param props.face - The side currently visible to the learner.
 * @param props.onFlip - Turn the current card to its other side.
 * @param props.disabled - Keep a committed rating undisturbed during feedback.
 * @returns Two small card faces with full-size touch targets and spoken labels.
 */
export function CardFaceIndicator({ face, onFlip, disabled = false, seenCount }: CardFaceIndicatorProps) {
  return <div className="card-face-indicator" role="group" aria-label="Card sides">
    {(['front', 'back'] as const).map(side => <button key={side} type="button" className="card-side-control"
      aria-label={side === 'front' ? 'Show question' : 'Show answer'}
      title={side === 'front' ? 'Show question' : 'Show answer'}
      aria-pressed={face === side} disabled={disabled}
      onClick={() => { if (face !== side) onFlip(); }}>
      <svg width="28" height="34" viewBox="0 0 28 34" fill="none" aria-hidden="true" focusable="false">
        <path className="card-side-paper" d="M5 2h14l6 6v21l-3 3H5l-3-3V5Z" />
        <path className="card-side-fold" d="M19 2v6h6" />
        {side === 'back' ? <g className="card-side-ink">
          <path d="M7 11h11v2H7Zm0 5h13v2H7Zm0 5h8v2H7Z" />
        </g> : <g>
          <path className="card-side-ink" d="m5 17 4-4h10l4 4-4 4H9Zm4 0 2 2h6l2-2-2-2h-6Z" fillRule="evenodd" />
          <path className="card-side-pupil" d="M12 15h4v4h-4Z" />
          <path className="card-side-glint" d="M13 15h1v1h-1Z" />
        </g>}
      </svg>
    </button>)}
    <CardSeenCount count={seenCount} />
  </div>;
}
