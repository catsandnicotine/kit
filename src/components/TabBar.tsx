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
      className="fixed bottom-0 left-0 right-0 z-30 flex justify-center border-t border-[#E5E5E5] dark:border-[#262626] bg-[var(--kit-bg)]"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {/* Learn tab */}
      <button
        onClick={() => handleTap('learn')}
        className={`flex flex-col items-center justify-center gap-[2px] py-2.5 px-8 transition-colors ${
          mode === 'learn' ? active : inactive
        }`}
        aria-label="Learn"
      >
        {/* Fixed 24×24 icon container */}
        <div className="w-6 h-6 flex items-center justify-center">
          {mode === 'learn' ? (
            /* Filled lightbulb — active, compact */
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3C9.2 3 7 5.2 7 8C7 10 8.1 11.7 9.7 12.6V15C9.7 15.4 10 15.8 10.5 15.8H13.5C14 15.8 14.3 15.4 14.3 15V12.6C15.9 11.7 17 10 17 8C17 5.2 14.8 3 12 3Z" fill="currentColor" fillOpacity="0.15" />
              <path d="M12 3C9.2 3 7 5.2 7 8C7 10 8.1 11.7 9.7 12.6V15C9.7 15.4 10 15.8 10.5 15.8H13.5C14 15.8 14.3 15.4 14.3 15V12.6C15.9 11.7 17 10 17 8C17 5.2 14.8 3 12 3Z" />
              <line x1="10" y1="18.5" x2="14" y2="18.5" />
              <line x1="10.5" y1="15.8" x2="10.5" y2="18.5" />
              <line x1="13.5" y1="15.8" x2="13.5" y2="18.5" />
            </svg>
          ) : (
            /* Outline lightbulb — inactive, compact */
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3C9.2 3 7 5.2 7 8C7 10 8.1 11.7 9.7 12.6V15C9.7 15.4 10 15.8 10.5 15.8H13.5C14 15.8 14.3 15.4 14.3 15V12.6C15.9 11.7 17 10 17 8C17 5.2 14.8 3 12 3Z" />
              <line x1="10" y1="18.5" x2="14" y2="18.5" />
              <line x1="10.5" y1="15.8" x2="10.5" y2="18.5" />
              <line x1="13.5" y1="15.8" x2="13.5" y2="18.5" />
            </svg>
          )}
        </div>
        <span className={`text-xs ${mode === 'learn' ? 'font-bold' : 'font-semibold'}`}>
          Learn
        </span>
      </button>

      {/* Review tab */}
      <button
        onClick={() => handleTap('review')}
        className={`flex flex-col items-center justify-center gap-[2px] py-2.5 px-8 transition-colors ${
          mode === 'review' ? active : inactive
        }`}
        aria-label="Review"
      >
        <div className="w-6 h-6 flex items-center justify-center">
          {mode === 'review' ? (
            /* Filled stacked cards — active */
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="7" width="15" height="12" rx="2" fill="currentColor" fillOpacity="0.15" />
              <rect x="2" y="7" width="15" height="12" rx="2" />
              <path d="M7 7V5.5A1.5 1.5 0 0 1 8.5 4h12A1.5 1.5 0 0 1 22 5.5v10A1.5 1.5 0 0 1 20.5 17H17" />
            </svg>
          ) : (
            /* Outline stacked cards — inactive */
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="7" width="15" height="12" rx="2" />
              <path d="M7 7V5.5A1.5 1.5 0 0 1 8.5 4h12A1.5 1.5 0 0 1 22 5.5v10A1.5 1.5 0 0 1 20.5 17H17" />
            </svg>
          )}
        </div>
        <span className={`text-xs ${mode === 'review' ? 'font-bold' : 'font-semibold'}`}>
          Review
        </span>
      </button>
    </nav>
  );
}
