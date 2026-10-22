import type { PracticeNavigationButtonProps } from '../types/practiceNavigation';

/** Keep practice browsing in the footer's existing, stable corner slots.
 * @param props - Direction, guarded availability and session navigation callback.
 * @returns An unframed 44px target, visibly dimmed at a boundary.
 */
export function PracticeNavigationButton({ direction, disabled, onNavigate }: PracticeNavigationButtonProps) {
  return <button type="button" onClick={onNavigate} disabled={disabled} className="kit-icon-button text-[#777] disabled:opacity-30 dark:text-[#aaa]" aria-label={direction === 'previous' ? 'Previous card' : 'Next card'}>
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={direction === 'previous' ? 'M19 12H5m6-6-6 6 6 6' : 'M5 12h14m-6-6 6 6-6 6'} />
    </svg>
  </button>;
}
