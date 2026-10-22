import { EyeGlyph } from './EyeGlyph';
import type { ShowAnswerButtonProps } from '../types/pixelArt';

/**
 * Reveal a card's answer with a shaded pixel-art eye.
 * @param props.onReveal - The current study session's flip action.
 * @param props.practice - Use the close lapis orbit for unscheduled practice.
 * @returns An uncaptioned eye with an accessible action name.
 */
export function ShowAnswerButton({ onReveal, practice = false }: ShowAnswerButtonProps) {
  return <button type="button" onClick={onReveal} className="show-answer-control" aria-label={practice ? 'Show answer, practice' : 'Show answer'} title="Show answer">
    <EyeGlyph variant={practice ? 'practice' : 'aureole'} idle />
    <svg className="reveal-turn" width="28" height="22" viewBox="0 0 32 24" fill="currentColor" shapeRendering="crispEdges" aria-hidden="true" focusable="false">
      {/* The far ribbon passes behind a card; the broad near fold turns across it. */}
      <path opacity=".42" d="M8 5h4v2H8v1H5v2H3v3H1V9h2V7h2V6h3ZM20 5h5v1h3v2h2v4h-2V9h-3V8h-5Z" />
      <path opacity=".22" d="M13 1h7v2h2v16h-2v2h-7v-2h-2V3h2Z" />
      <path opacity=".6" d="M13 1h7v1h-7ZM11 3h1v10h-1ZM20 3h1v10h-1Z" />
      <path d="M1 11h2v3h3v2h5v1h9v-4h2v2h3v2h3v2h-3v2h-3v2h-2v-4h-9v-1H6v-1H3v-2H1Z" />
      <path opacity=".35" d="M3 14h3v2h5v1h9v1h-9v-1H6v-1H3Z" />
    </svg>
  </button>;
}
