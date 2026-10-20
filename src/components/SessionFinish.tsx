import { RatingGlyph } from './RatingGlyph';
import { UiIcon } from './UiIcon';

/** One finish, one exit, and an optional consequence-free continuation.
 * @param props - Session title, concise result, next due date, and available actions.
 * @returns A quiet completion view shared by study and practice.
 */
export function SessionFinish({ title, detail, nextDue, onDone, onPractise, error, showMark = true }: {
  showMark?: boolean; title:string; detail?:string | undefined; nextDue?:string | null | undefined;
  onDone?: (() => void) | undefined; onPractise?: (() => void) | undefined; error?:string | null | undefined;
}) {
  return <main className="study-finish">
    <div className="study-finish-summary">
      {showMark && <div className="study-finish-mark" aria-hidden="true"><RatingGlyph rating="good" /></div>}
      <h2 className="study-finish-title">{title}</h2>
      {detail && <p className="study-finish-stats">{detail}</p>}
      {nextDue && <p className="study-finish-detail">Next review {nextDue}</p>}
    </div>
    <div className="study-finish-actions">
      {error && <p className="text-sm text-red-500" role="alert">{error}</p>}
      {onPractise && <button type="button" onClick={onPractise} className="study-finish-optional" title="Practise without changing review dates"><UiIcon name="repeat" />Keep practising</button>}
      {onDone && <button type="button" onClick={onDone} className="study-finish-done">Done</button>}
    </div>
  </main>;
}
