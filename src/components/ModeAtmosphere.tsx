import './ModeAtmosphere.css';

/** Add a restrained, non-interactive pigment wash at the screen's lower edge.
 * @param props.mode - The active scheduled or unscheduled study mode.
 * @returns One fixed-size blurred texture; motion changes only its transform.
 */
export function ModeAtmosphere({ mode }: { mode: 'study' | 'practice' }) {
  return <div className={`mode-atmosphere mode-atmosphere--${mode}`} aria-hidden="true"><div /></div>;
}
