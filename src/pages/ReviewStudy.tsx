import { CardFaceIndicator } from '../components/CardFaceIndicator';
import { SessionFinish } from '../components/SessionFinish';
import { DeckName } from '../components/DeckName';
/**
 * ReviewStudy — physical-flashcard mode study page.
 *
 * Cards are shuffled randomly. No FSRS, no scoring, no DB writes.
 * Actions: Return to the pile or put aside.
 *
 * @param db       - sql.js Database instance (null while loading).
 * @param deckId   - Deck UUID.
 * @param deckName - Deck display name.
 * @param onExit   - Called when the user leaves (back or done).
 */

import { ShowAnswerButton } from '../components/ShowAnswerButton';
import { useLayoutEffect, useMemo, useRef } from 'react';
import type { Database } from 'sql.js';
import { useReviewStudySession } from '../hooks/useReviewStudySession';
import { useDeckMedia } from '../hooks/useDeckMedia';
import { useTheme } from '../hooks/useTheme';
import { hapticTap } from '../lib/platform/haptics';
import { ReviewChoices } from '../components/ReviewChoices';
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

  useLayoutEffect(() => {
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
    putAside,
    reshufflePutAside,
  } = session;

  const { rewriteHtml, loading: mediaLoading } = useDeckMedia(db, deckId);
  const { theme } = useTheme();

  const bodyClass = useMemo(() => {
    const classes: string[] = [];
    if (theme === 'dark' || theme === 'black') classes.push('night_mode');
    if (theme === 'black') classes.push('black_mode');
    return classes.join(' ');
  }, [theme]);

  const frontHtml = useMemo(() => {
    if (!currentCard || mediaLoading) return '';
    return renderImageOcclusion(rewriteHtml(currentCard.front), 'front');
  }, [currentCard, rewriteHtml, mediaLoading]);

  const backHtml = useMemo(() => {
    if (!currentCard || mediaLoading) return '';
    return renderImageOcclusion(rewriteHtml(currentCard.back), 'back');
  }, [currentCard, rewriteHtml, mediaLoading]);

  // ── Loading ─────────────────────────────────────────────────────────────
  if (phase === 'loading' || mediaLoading) {
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

  if (phase === 'error') return <main className="h-[100dvh] flex flex-col bg-[var(--kit-bg)] text-[#1c1c1e] dark:text-[#E5E5E5]">
    <header className="kit-page-header"><button type="button" className="kit-icon-button" onClick={onExit} aria-label="Back">‹</button><DeckName name={deckName} /></header>
    <div className="flex-1 flex flex-col items-center justify-center gap-5 px-6"><p role="alert" className="text-sm">{session.errorMessage}</p><button type="button" className="kit-secondary-button" onClick={session.retry}>Try again</button></div>
  </main>;

  // ── Complete ────────────────────────────────────────────────────────────
  if (phase === 'complete') {
    return <div className="h-[100dvh] flex flex-col bg-[var(--kit-bg)] text-[#1c1c1e] dark:text-[#E5E5E5]">
      <header className="practice-finish-header"><DeckName name={deckName} /></header>
      <SessionFinish showMark={stats.total > 0} title={stats.total ? 'Practice complete' : 'No cards yet'} detail={stats.total ? `${stats.putAside} ${stats.putAside === 1 ? 'card' : 'cards'}` : undefined} onDone={() => { hapticTap(); onExit(); }} onPractise={stats.putAside > 0 ? reshufflePutAside : undefined} />
    </div>;
  }

  // ── Study screen ────────────────────────────────────────────────────────
  return (
    <div className={`study-session ${phase === 'front' ? 'study-session--question' : ''} h-[100dvh] flex flex-col bg-[var(--kit-bg)] text-[#1c1c1e] dark:text-[#E5E5E5] select-none`}>
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
          <DeckName name={deckName} /> <span className="study-mode-label">Practice</span>
        </span>
        <span className="text-xs text-[#C4C4C4] shrink-0 tabular-nums">
          {stats.remaining} left
        </span>
      </header>

      <CardFaceIndicator face={phase === 'front' ? 'front' : 'back'} />

      {/* Card area — tap to flip */}
      <div
        className={`flex-1 min-h-0 relative overflow-hidden study-card-area ${phase === 'front' ? 'study-card-area--question' : ''}`}
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
        <div className={`absolute inset-0 flex items-center justify-center study-question-content bg-[var(--kit-bg)] ${phase === 'front' ? '' : 'card-face-hidden'}`}>
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
                  className="px-2 py-0.5 text-[10px] text-[#C4C4C4] bg-[var(--kit-surface)] rounded-full"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

      </div>

      <footer className={`study-footer ${phase === 'front' ? 'study-footer--question' : ''}`}>
        <div className="study-controls-main">
          {phase === 'back' ? <ReviewChoices onRepeat={sendToBack} onPutAside={putAside} />
            : <ShowAnswerButton onReveal={flip} />}
        </div>
      </footer>
    </div>
  );
}
