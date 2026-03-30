/**
 * ReviewStudy — physical-flashcard mode study page.
 *
 * Cards are shuffled randomly. No FSRS, no scoring, no DB writes.
 * Actions: Send to back, Send to middle, Put aside.
 *
 * @param db       - sql.js Database instance (null while loading).
 * @param deckId   - Deck UUID.
 * @param deckName - Deck display name.
 * @param onExit   - Called when the user leaves (back or done).
 */

import { useEffect, useMemo, useRef } from 'react';
import type { Database } from 'sql.js';
import { useReviewStudySession } from '../hooks/useReviewStudySession';
import { useDeckMedia } from '../hooks/useDeckMedia';
import { useTheme } from '../hooks/useTheme';
import { hapticTap } from '../lib/platform/haptics';
import { renderImageOcclusion } from '../lib/imageOcclusion';

// ---------------------------------------------------------------------------
// Card content renderer — uses ref-based innerHTML for script/mask compat
// ---------------------------------------------------------------------------

function CardContent({
  html,
  bodyClass,
}: {
  html: string;
  bodyClass: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const currentHtmlRef = useRef('');

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const outerOpen = bodyClass ? `<div class="${bodyClass}">` : '';
    const outerClose = bodyClass ? '</div>' : '';
    const fullHtml = `${outerOpen}<div class="card">${html}</div>${outerClose}`;
    if (currentHtmlRef.current === fullHtml) return;
    currentHtmlRef.current = fullHtml;
    el.innerHTML = fullHtml;
  }, [html, bodyClass]);

  return (
    <div
      className="card-content w-full h-full min-h-0 overflow-y-auto overflow-x-hidden"
      style={{
        padding: '1.5rem',
      }}
    >
      <div ref={containerRef} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

interface ReviewStudyProps {
  db: Database | null;
  deckId: string;
  deckName: string;
  onExit: () => void;
}

export default function ReviewStudy({ db, deckId, deckName, onExit }: ReviewStudyProps) {
  const session = useReviewStudySession(db, deckId);
  const {
    phase,
    currentCard,
    stats,
    flip,
    sendToBack,
    sendToMiddle,
    putAside,
    reshufflePutAside,
  } = session;

  const { rewriteHtml } = useDeckMedia(db, deckId);
  const { theme } = useTheme();

  const bodyClass = useMemo(() => {
    const classes: string[] = [];
    if (theme === 'dark' || theme === 'black') classes.push('night_mode');
    if (theme === 'black') classes.push('black_mode');
    return classes.join(' ');
  }, [theme]);

  const frontHtml = useMemo(() => {
    if (!currentCard) return '';
    return renderImageOcclusion(rewriteHtml(currentCard.front), 'front');
  }, [currentCard, rewriteHtml]);

  const backHtml = useMemo(() => {
    if (!currentCard) return '';
    return renderImageOcclusion(rewriteHtml(currentCard.back), 'back');
  }, [currentCard, rewriteHtml]);

  // ── Loading ─────────────────────────────────────────────────────────────
  if (phase === 'loading') {
    return (
      <div className="min-h-[100dvh] flex flex-col bg-[var(--kit-bg)] text-[#1c1c1e] dark:text-[#E5E5E5]">
        <header
          className="flex items-center gap-3 pb-3 border-b border-[#E5E5E5] dark:border-[#262626] shrink-0"
          style={{
            paddingTop: 'calc(env(safe-area-inset-top) + 0.75rem)',
            paddingLeft: 'max(1rem, env(safe-area-inset-left))',
            paddingRight: 'max(1rem, env(safe-area-inset-right))',
          }}
        >
          <button
            onClick={() => { hapticTap(); onExit(); }}
            className="p-2 -ml-2 text-[#C4C4C4] hover:text-[#1c1c1e] dark:hover:text-[#E5E5E5] transition-colors shrink-0"
            aria-label="Back"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <span className="text-sm font-semibold truncate">{deckName}</span>
        </header>
        <div className="flex-1 flex items-center justify-center">
          <div className="kit-loading-bar"><div className="kit-loading-fill" /></div>
        </div>
      </div>
    );
  }

  // ── Complete ────────────────────────────────────────────────────────────
  if (phase === 'complete') {
    return (
      <div className="min-h-[100dvh] flex flex-col bg-[var(--kit-bg)] text-[#1c1c1e] dark:text-[#E5E5E5]">
        <header
          className="flex items-center gap-3 pb-3 border-b border-[#E5E5E5] dark:border-[#262626] shrink-0"
          style={{
            paddingTop: 'calc(env(safe-area-inset-top) + 0.75rem)',
            paddingLeft: 'max(1rem, env(safe-area-inset-left))',
            paddingRight: 'max(1rem, env(safe-area-inset-right))',
          }}
        >
          <button
            onClick={() => { hapticTap(); onExit(); }}
            className="p-2 -ml-2 text-[#C4C4C4] hover:text-[#1c1c1e] dark:hover:text-[#E5E5E5] transition-colors shrink-0"
            aria-label="Back"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <span className="text-sm font-semibold truncate">{deckName}</span>
        </header>

        <div
          className="flex-1 overflow-auto"
          style={{
            paddingBottom: 'max(1rem, env(safe-area-inset-bottom))',
            paddingLeft: 'max(1rem, env(safe-area-inset-left))',
            paddingRight: 'max(1rem, env(safe-area-inset-right))',
          }}
        >
          <div className="flex flex-col items-center gap-2 pt-8 pb-6">
            <h2 className="text-base font-bold">Review complete</h2>
          </div>

          <section className="px-4 pb-4">
            <div className="bg-[var(--kit-surface)] border border-[#E5E5E5] dark:border-[#262626] rounded-lg p-4 flex flex-col gap-2">
              <div className="flex justify-between text-sm">
                <span className="text-[#C4C4C4]">Total cards</span>
                <span className="font-medium">{stats.total}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[#C4C4C4]">Put aside</span>
                <span className="font-medium">{stats.putAside}</span>
              </div>
            </div>
          </section>

          <div className="px-4 flex flex-col gap-3">
            {stats.putAside > 0 && (
              <button
                onClick={reshufflePutAside}
                className="w-full py-3 text-sm font-semibold border border-[#D4D4D4] dark:border-[#404040] rounded-lg active:opacity-80 transition-opacity"
              >
                Shuffle put-aside cards ({stats.putAside})
              </button>
            )}
            <button
              onClick={() => { hapticTap(); onExit(); }}
              className="w-full py-3 text-sm font-semibold bg-[#1c1c1e] dark:bg-[#E5E5E5] text-white dark:text-[#0A0A0A] rounded-lg active:opacity-80 transition-opacity"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Study screen ────────────────────────────────────────────────────────
  return (
    <div className="min-h-[100dvh] flex flex-col bg-[var(--kit-bg)] text-[#1c1c1e] dark:text-[#E5E5E5] select-none">
      {/* Header */}
      <header
        className="flex items-center gap-3 shrink-0 border-b border-[#E5E5E5] dark:border-[#262626]"
        style={{
          paddingTop: 'calc(env(safe-area-inset-top) + 0.75rem)',
          paddingBottom: '0.5rem',
          paddingLeft: 'max(1rem, env(safe-area-inset-left))',
          paddingRight: 'max(1rem, env(safe-area-inset-right))',
        }}
      >
        <button
          onClick={() => { hapticTap(); onExit(); }}
          className="p-2 -ml-2 text-[#C4C4C4] hover:text-[#1c1c1e] dark:hover:text-[#E5E5E5] transition-colors shrink-0"
          aria-label="Back"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <span className="text-sm font-medium text-[#C4C4C4] truncate flex-1 text-center">
          {deckName}
        </span>
        <span className="text-xs text-[#C4C4C4] shrink-0 tabular-nums">
          {stats.remaining} left
        </span>
      </header>

      {/* No-scoring banner */}
      <div className="flex justify-center py-1.5 bg-[var(--kit-surface)] border-b border-[#E5E5E5] dark:border-[#262626]">
        <span className="text-[10px] font-medium text-[#C4C4C4] uppercase tracking-widest">
          Review mode — no scoring
        </span>
      </div>

      {/* Card area — tap to flip */}
      <div
        className="flex-1 min-h-0 relative"
        onClick={() => { if (phase === 'front') flip(); }}
        onKeyDown={(e) => {
          if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            if (phase === 'front') flip();
          }
        }}
        role="button"
        tabIndex={0}
        aria-label={phase === 'front' ? 'Tap to flip' : 'Card back'}
      >
        {/* Front face */}
        <div className={`absolute inset-0 flex items-center justify-center bg-[var(--kit-bg)] ${phase === 'front' ? '' : 'card-face-hidden'}`}>
          <CardContent html={frontHtml} bodyClass={bodyClass} />
        </div>

        {/* Back face */}
        <div className={`absolute inset-0 flex items-center justify-center bg-[var(--kit-bg)] ${phase === 'back' ? '' : 'card-face-hidden'}`}>
          <CardContent html={backHtml} bodyClass={bodyClass} />

          {/* Tags */}
          {currentCard && currentCard.tags.length > 0 && (
            <div className="absolute bottom-4 left-0 right-0 flex flex-wrap justify-center gap-1.5 px-4 pointer-events-none">
              {currentCard.tags.map(tag => (
                <span
                  key={tag}
                  className="px-2 py-0.5 text-[10px] text-[#C4C4C4] bg-[var(--kit-surface)] border border-[#E5E5E5] dark:border-[#333] rounded-full"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Tap hint on front */}
        {phase === 'front' && (
          <div className="absolute bottom-4 left-0 right-0 text-center pointer-events-none">
            <span className="text-xs text-[#C4C4C4]">tap to flip</span>
          </div>
        )}
      </div>

      {/* Action bar — visible on back */}
      {phase === 'back' && (
        <div
          className="shrink-0 border-t border-[#E5E5E5] dark:border-[#262626] bg-[var(--kit-bg)]"
          style={{
            paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))',
            paddingLeft: 'max(1rem, env(safe-area-inset-left))',
            paddingRight: 'max(1rem, env(safe-area-inset-right))',
          }}
        >
          <div className="flex gap-3 pt-3">
            {/* Send to back */}
            <button
              onClick={sendToBack}
              className="flex-1 py-3 flex flex-col items-center gap-1 text-xs font-medium border border-[#D4D4D4] dark:border-[#404040] rounded-lg active:scale-[0.97] transition-transform"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="7 13 12 18 17 13" />
                <line x1="12" y1="6" x2="12" y2="18" />
              </svg>
              <span>To back</span>
            </button>

            {/* Send to middle */}
            <button
              onClick={sendToMiddle}
              className="flex-1 py-3 flex flex-col items-center gap-1 text-xs font-semibold bg-[#1c1c1e] dark:bg-[#E5E5E5] text-white dark:text-[#0A0A0A] rounded-lg active:scale-[0.97] transition-transform"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="16 3 21 3 21 8" />
                <line x1="4" y1="20" x2="21" y2="3" />
                <polyline points="21 16 21 21 16 21" />
                <line x1="15" y1="15" x2="21" y2="21" />
                <line x1="4" y1="4" x2="9" y2="9" />
              </svg>
              <span>To middle</span>
            </button>

            {/* Put aside */}
            <button
              onClick={putAside}
              className="flex-1 py-3 flex flex-col items-center gap-1 text-xs font-medium text-green-600 dark:text-green-400 border border-green-300 dark:border-green-700 rounded-lg active:scale-[0.97] transition-transform"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span>Put aside</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
