import { CardFaceIndicator } from './CardFaceIndicator';
import { SessionFinish } from './SessionFinish';
import { DeckName } from './DeckName';
/**
 * ReviewPassView — full-screen consequence-free review UI.
 *
 * Used from Study (Review Again) and Browse (review selected cards).
 * No FSRS ratings, no DB writes. Shows "Got it" and "Repeat" only.
 */

import { ShowAnswerButton } from './ShowAnswerButton';
import { useMemo } from 'react';
import type { Card } from '../types';
import { useReviewPass } from '../hooks/useReviewPass';
import { hapticTap } from '../lib/platform/haptics';
import { ReviewChoices } from './ReviewChoices';
import { useTheme } from '../hooks/useTheme';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ReviewPassViewProps {
  /** Cards to review. The list is copied into a mutable queue. */
  cards: Card[];
  /** Human-readable context label shown in the header (e.g. deck name). */
  contextLabel?: string;
  /** Rewrite media src→blob for display. */
  rewriteHtml?: (html: string) => string;
  /** Called when the user finishes (complete screen Done button or header Back). */
  onDone: () => void;
  onBack?: (() => void) | undefined;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function CardContent({
  html,
  visible,
}: {
  html: string;
  visible: boolean;
}) {
  const { theme } = useTheme();
  const bodyClass = theme === 'black' ? 'night_mode black_mode' : theme === 'dark' ? 'night_mode' : '';
  return (
    <div
      className={`card-content w-full h-full overflow-auto flex items-center justify-center ${visible ? '' : 'card-face-hidden'}`}
      style={{
        padding:
          'max(1.5rem, env(safe-area-inset-top)) max(1.5rem, env(safe-area-inset-right)) max(1.5rem, env(safe-area-inset-bottom)) max(1.5rem, env(safe-area-inset-left))',
      }}
      dangerouslySetInnerHTML={{ __html: `<div class="${bodyClass}"><div class="card">${html}</div></div>` }}
    />
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Full-screen no-scoring review view.
 *
 * @param cards        - Cards to review.
 * @param contextLabel - Deck/context name shown in header.
 * @param rewriteHtml  - Media URL rewriter.
 * @param onDone       - Called when the session is finished.
 */
export function ReviewPassView({
  cards,
  contextLabel,
  rewriteHtml,
  onDone,
  onBack,
}: ReviewPassViewProps) {
  const session = useReviewPass(cards);
  const { phase, currentCard, stats, flip, gotIt, repeat } = session;

  const frontHtml = useMemo(() => {
    if (!currentCard) return '';
    return rewriteHtml ? rewriteHtml(currentCard.front) : currentCard.front;
  }, [currentCard, rewriteHtml]);

  const backHtml = useMemo(() => {
    if (!currentCard) return '';
    return rewriteHtml ? rewriteHtml(currentCard.back) : currentCard.back;
  }, [currentCard, rewriteHtml]);

  const progress = cards.length === 0 ? 1 : stats.reviewed / cards.length;

  // ── Complete screen ────────────────────────────────────────────────────
  if (phase === 'complete') {
    return <div className="h-[100dvh] flex flex-col bg-[var(--kit-bg)] text-[#1c1c1e] dark:text-[#E5E5E5]">
      <header className="practice-finish-header"><DeckName name={contextLabel ?? 'Practice'} /></header>
      <SessionFinish showMark={stats.reviewed > 0} title={stats.reviewed ? 'Practice complete' : 'No cards yet'} detail={stats.reviewed ? `${stats.reviewed} ${stats.reviewed === 1 ? 'card' : 'cards'}` : undefined} onDone={() => { hapticTap(); onDone(); }} />
    </div>;
  }

  // ── Study screen ───────────────────────────────────────────────────────
  return (
    <div className={`study-session ${phase === 'front' ? 'study-session--question' : ''} h-[100dvh] flex flex-col bg-[var(--kit-bg)] text-[#1c1c1e] dark:text-[#E5E5E5] select-none`}>
      {/* Header */}
      <header
        className="flex items-center gap-3 shrink-0 border-b border-[#E5E5E5] dark:border-[#262626]"
        style={{
          paddingTop: 'env(safe-area-inset-top)',
          paddingBottom: '0.5rem',
          paddingLeft: 'max(1rem, env(safe-area-inset-left))',
          paddingRight: 'max(1rem, env(safe-area-inset-right))',
        }}
      >
        <button
          onClick={() => { hapticTap(); (onBack ?? onDone)(); }}
          aria-label="Back"
          className="kit-icon-button text-sm font-medium text-[#1c1c1e] dark:text-[#E5E5E5] shrink-0"
        >
          ← Back
        </button>
        <span className="text-sm font-medium text-[#C4C4C4] truncate flex-1 text-center">
          <DeckName name={contextLabel ?? 'Practice'} /> <span className="study-mode-label">Practice</span>
        </span>
        <span className="text-xs text-[#C4C4C4] shrink-0 tabular-nums">
          {stats.remaining} left
        </span>
      </header>

      {/* Progress bar */}
      <div className="study-progress px-4 py-1">
        <div className="deck-progress-track bg-[#E5E5E5] dark:bg-[#262626] w-full">
          <div
            className="deck-progress-fill bg-[#1c1c1e] dark:bg-[#E5E5E5]"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
      </div>

      <CardFaceIndicator face={phase === 'front' ? 'front' : 'back'} />

      {/* Card area */}
      <div
        className={`flex-1 min-h-0 relative overflow-hidden cursor-pointer study-card-area ${phase === 'front' ? 'study-card-area--question' : ''}`}
        role="button"
        tabIndex={0}
        onClick={phase === 'front' ? flip : undefined}
        onKeyDown={e => { if ((e.key === ' ' || e.key === 'Enter') && phase === 'front') flip(); }}
      >
        {/* Front */}
        <div
          className={`absolute inset-0 flex items-center justify-center study-question-content bg-[var(--kit-bg)] ${
            phase === 'front' ? '' : 'card-face-hidden'
          }`}
        >
          <CardContent html={frontHtml} visible={phase === 'front'} />
        </div>
        {/* Back */}
        <div
          className={`absolute inset-0 flex items-center justify-center bg-[var(--kit-bg)] ${
            phase === 'back' ? '' : 'card-face-hidden'
          }`}
        >
          <CardContent html={backHtml} visible={phase === 'back'} />
        </div>

        {/* Tags (shown on back) */}
        {phase === 'back' && currentCard && currentCard.tags.length > 0 && (
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

      {/* Bottom bar */}
      <div className={`study-footer ${phase === 'front' ? 'study-footer--question' : ''}`}>
        <div className="study-controls-main">
          {phase === 'back' ? <ReviewChoices onRepeat={repeat} onPutAside={gotIt} />
            : <ShowAnswerButton onReveal={flip} />}
        </div>
      </div>
    </div>
  );
}
