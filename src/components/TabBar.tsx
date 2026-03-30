/**
 * TabBar — bottom tab bar for switching between Learn and Review modes.
 *
 * Apple-style: active tab uses filled icon + bold label, inactive uses outline.
 * Icon container is fixed-size so switching tabs causes zero layout shift.
 */

import type { AppMode } from '../App';
import { hapticTap } from '../lib/platform/haptics';

/** Total height of the tab bar including safe-area inset. */
export const TAB_BAR_TOTAL_HEIGHT = 'calc(56px + env(safe-area-inset-bottom))';

interface TabBarProps {
  mode: AppMode;
  onChange: (mode: AppMode) => void;
}

export function TabBar({ mode, onChange }: TabBarProps) {
  const handleTap = (next: AppMode) => {
    if (next === mode) return;
    hapticTap();
    onChange(next);
  };

  const active = 'text-[#1c1c1e] dark:text-[#E5E5E5]';
  const inactive = 'text-[#A0A0A0] dark:text-[#555]';

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-30 flex border-t border-[#E5E5E5] dark:border-[#262626] bg-[var(--kit-bg)]"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {/* Learn tab */}
      <button
        onClick={() => handleTap('learn')}
        className={`flex-1 flex flex-col items-center justify-center gap-[3px] py-2.5 transition-colors ${
          mode === 'learn' ? active : inactive
        }`}
        aria-label="Learn"
      >
        {/* Fixed 28×28 icon container — prevents layout shift on active change */}
        <div className="w-7 h-7 flex items-center justify-center">
          {mode === 'learn' ? (
            /* Filled lightbulb — active */
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2C8.7 2 6 4.7 6 8C6 10.4 7.3 12.5 9.3 13.6V16C9.3 16.6 9.7 17 10.3 17H13.7C14.3 17 14.7 16.6 14.7 16V13.6C16.7 12.5 18 10.4 18 8C18 4.7 15.3 2 12 2Z" fill="currentColor" fillOpacity="0.15" />
              <path d="M12 2C8.7 2 6 4.7 6 8C6 10.4 7.3 12.5 9.3 13.6V16C9.3 16.6 9.7 17 10.3 17H13.7C14.3 17 14.7 16.6 14.7 16V13.6C16.7 12.5 18 10.4 18 8C18 4.7 15.3 2 12 2Z" />
              <line x1="10" y1="20" x2="14" y2="20" />
              <line x1="10.5" y1="17" x2="10.5" y2="20" />
              <line x1="13.5" y1="17" x2="13.5" y2="20" />
            </svg>
          ) : (
            /* Outline lightbulb — inactive */
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2C8.7 2 6 4.7 6 8C6 10.4 7.3 12.5 9.3 13.6V16C9.3 16.6 9.7 17 10.3 17H13.7C14.3 17 14.7 16.6 14.7 16V13.6C16.7 12.5 18 10.4 18 8C18 4.7 15.3 2 12 2Z" />
              <line x1="10" y1="20" x2="14" y2="20" />
              <line x1="10.5" y1="17" x2="10.5" y2="20" />
              <line x1="13.5" y1="17" x2="13.5" y2="20" />
            </svg>
          )}
        </div>
        <span className={`text-[10.5px] ${mode === 'learn' ? 'font-bold' : 'font-medium'}`}>
          Learn
        </span>
      </button>

      {/* Review tab */}
      <button
        onClick={() => handleTap('review')}
        className={`flex-1 flex flex-col items-center justify-center gap-[3px] py-2.5 transition-colors ${
          mode === 'review' ? active : inactive
        }`}
        aria-label="Review"
      >
        <div className="w-7 h-7 flex items-center justify-center">
          {mode === 'review' ? (
            /* Filled stacked cards — active */
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="7" width="15" height="12" rx="2" fill="currentColor" fillOpacity="0.15" />
              <rect x="2" y="7" width="15" height="12" rx="2" />
              <path d="M7 7V5.5A1.5 1.5 0 0 1 8.5 4h12A1.5 1.5 0 0 1 22 5.5v10A1.5 1.5 0 0 1 20.5 17H17" />
            </svg>
          ) : (
            /* Outline stacked cards — inactive */
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="7" width="15" height="12" rx="2" />
              <path d="M7 7V5.5A1.5 1.5 0 0 1 8.5 4h12A1.5 1.5 0 0 1 22 5.5v10A1.5 1.5 0 0 1 20.5 17H17" />
            </svg>
          )}
        </div>
        <span className={`text-[10.5px] ${mode === 'review' ? 'font-bold' : 'font-medium'}`}>
          Review
        </span>
      </button>
    </nav>
  );
}
