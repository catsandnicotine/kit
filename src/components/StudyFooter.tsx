import type { StudyFooterProps } from '../types/studyUi';
import { CardFaceIndicator } from './CardFaceIndicator';

/** Keep each action's canvas stable while the card's layout catches up with its turn.
 * @param props - Immediate action face, stable layout face, turn action and optional tools.
 * @returns A shared footer with balanced 44px tool slots and centred face controls.
 */
export function StudyFooter({ face, layoutFace = face, seenCount, onFlip, disabled = false, inert = false, frontActions, backActions, leading, trailing }: StudyFooterProps) {
  return <footer className={`study-footer ${layoutFace === 'front' ? 'study-footer--question' : ''}`} inert={inert}>
    <div className="study-controls">
      <div className="study-controls-main">
        <div className={`study-action-layer study-action-layer--front ${face === 'front' ? 'is-current' : ''}`} aria-hidden={face !== 'front'} inert={face !== 'front'}>{frontActions}</div>
        <div className={`study-action-layer study-action-layer--back ${face === 'back' ? 'is-current' : ''}`} aria-hidden={face !== 'back'} inert={face !== 'back'}>{backActions}</div>
      </div>
      <div className="study-tools">
        <span className="study-tools-slot">{leading}</span>
        <CardFaceIndicator face={face} onFlip={onFlip} disabled={disabled} seenCount={seenCount} />
        <span className="study-tools-slot">{trailing}</span>
      </div>
    </div>
  </footer>;
}
