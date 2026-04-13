/**
 * TabBar — floating bottom bar with centered Learn / Review pills
 * and a chevron FAB in the bottom-left corner.
 *
 * The chevron expands upward into Tags / Settings pills.
 * Learn / Review are pill toggles with a ring outline on press.
 */

import { useState } from 'react';
import type { AppMode } from '../App';
import { hapticTap, hapticNavigate } from '../lib/platform/haptics';

/** Total height reserved for the bar (used for bottom padding on scroll areas). */
export const TAB_BAR_TOTAL_HEIGHT = 'calc(68px + env(safe-area-inset-bottom))';

interface TabBarProps {
  mode: AppMode;
  onChange: (mode: AppMode) => void;
  onTags: () => void;
  onSettings: (scrollTo?: string) => void;
}

export function TabBar({ mode, onChange, onTags, onSettings }: TabBarProps) {
  const [fabOpen, setFabOpen] = useState(false);
  const closeFab = () => setFabOpen(false);

  const handleMode = (next: AppMode) => {
    if (next === mode) return;
    hapticTap();
    onChange(next);
  };

  return (
    <>
      {/* Backdrop */}
      {fabOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-enter"
          onClick={closeFab}
        />
      )}

      {/* FAB expansion — Tags + Settings pills */}
      {fabOpen && (
        <div
          className="fixed z-50 flex flex-col items-start gap-2.5"
          style={{
            bottom: 'calc(68px + env(safe-area-inset-bottom) + 0.25rem)',
            left: 'max(1.25rem, env(safe-area-inset-left))',
          }}
        >
          <button
            onClick={() => { closeFab(); hapticNavigate(); onTags(); }}
            className="flex items-center gap-2 px-5 py-3 rounded-full text-[var(--kit-pill-text)] text-sm font-medium shadow-lg active:opacity-80 transition-opacity pill-border fab-item-enter"
            style={{ animationDelay: '0.04s' }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
              <line x1="7" y1="7" x2="7.01" y2="7" />
            </svg>
            Tags
          </button>
          <button
            onClick={() => { closeFab(); hapticNavigate(); onSettings(); }}
            className="flex items-center gap-2 px-5 py-3 rounded-full text-[var(--kit-pill-text)] text-sm font-medium shadow-lg active:opacity-80 transition-opacity pill-border fab-item-enter"
            style={{ animationDelay: '0s' }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            Settings
          </button>
        </div>
      )}

      {/* Chevron — bottom-left corner */}
      <button
        onClick={() => { hapticTap(); setFabOpen(v => !v); }}
        className="fixed z-50 w-12 h-12 rounded-full text-[var(--kit-pill-text)] shadow-lg flex items-center justify-center active:scale-95 transition-transform pill-border"
        style={{
          bottom: 'calc(env(safe-area-inset-bottom) + 0.875rem)',
          left: 'max(1.25rem, env(safe-area-inset-left))',
        }}
        aria-label="More"
      >
        <svg
          width="22" height="22" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="2.5"
          strokeLinecap="round" strokeLinejoin="round"
          style={{ transform: fabOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}
        >
          <polyline points="5 15 12 8 19 15" />
        </svg>
      </button>

      {/* Centered Learn / Review pills */}
      <div
        className="fixed bottom-0 left-0 right-0 z-30 flex justify-center pointer-events-none"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 0.875rem)' }}
      >
        <div className="flex items-center gap-3 pointer-events-auto">
          <button
            onClick={() => handleMode('learn')}
            className={`px-6 py-3 rounded-full text-[15px] font-semibold shadow-lg transition-all ${
              mode === 'learn'
                ? 'text-[var(--kit-pill-text)] pill-border'
                : 'bg-[var(--kit-bg)] text-[#999] dark:text-[#666] border border-transparent active:ring-2 active:ring-[var(--kit-pill-edge)]'
            }`}
            aria-label="Learn"
          >
            Learn
          </button>

          <button
            onClick={() => handleMode('review')}
            className={`px-6 py-3 rounded-full text-[15px] font-semibold shadow-lg transition-all ${
              mode === 'review'
                ? 'text-[var(--kit-pill-text)] pill-border'
                : 'bg-[var(--kit-bg)] text-[#999] dark:text-[#666] border border-transparent active:ring-2 active:ring-[var(--kit-pill-edge)]'
            }`}
            aria-label="Review"
          >
            Review
          </button>
        </div>
      </div>
    </>
  );
}
