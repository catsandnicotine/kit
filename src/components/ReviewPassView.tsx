/**
 * ReviewPassView — full-screen consequence-free review UI.
 *
 * Used from Study (Review Again) and Browse (review selected cards).
 * No FSRS ratings, no DB writes. Shows "Got it" and "Repeat" only.
 */

import { useMemo } from 'react';
import type { Card } from '../types';
import { useReviewPass } from '../hooks/useReviewPass';
import { hapticTap } from '../lib/platform/haptics';

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
  return (
    <div
      className={`card-content w-full h-full overflow-auto flex items-center justify-center ${visible ? '' : 'card-face-hidden'}`}
      style={{
        padding:
          'max(1.5rem, env(safe-area-inset-top)) max(1.5rem, env(safe-area-inset-right)) max(1.5rem, env(safe-area-inset-bottom)) max(1.5rem, env(safe-area-inset-left))',
      }}
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: html }}
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
    return (
      <div className="min-h-[100dvh] flex flex-col bg-[var(--kit-bg)] text-[#1c1c1e] dark:text-[#E5E5E5]">
        <header
          className="flex items-center gap-3 pb-3 border-b border-[#E5E5E5] dark:border-[#262626] shrink-0"
          style={{
            paddingTop: 'env(safe-area-inset-top)',
            paddingLeft: 'max(1rem, env(safe-area-inset-left))',
            paddingRight: 'max(1rem, env(safe-area-inset-right))',
          }}
        >
          <button
            onClick={() => { hapticTap(); onDone(); }}
            className="text-sm font-medium text-[#C4C4C4] shrink-0"
          >
            &larr; Back
          </button>
          <span className="text-sm font-semibold truncate">
            {contextLabel ?? 'Review pass'}
          </span>
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
            <h2 className="text-base font-bold">Review pass complete</h2>
          </div>
          <section className="px-4 pb-4">
            <div className="bg-[var(--kit-surface)] border border-[#E5E5E5] dark:border-[#262626] rounded-lg p-4 flex flex-col gap-2">
              <div className="flex justify-between text-sm">
                <span className="text-[#C4C4C4]">Reviewed</span>
                <span className="font-medium">
                  {stats.reviewed} {stats.reviewed === 1 ? 'card' : 'cards'}
                </span>
              </div>
              {stats.totalRepeats > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-[#C4C4C4]">Repeated</span>
                  <span className="font-medium">
                    {stats.totalRepeats} {stats.totalRepeats === 1 ? 'time' : 'times'}
                  </span>
                </div>
              )}
            </div>
          </section>
          <div className="px-4">
            <button
              onClick={() => { hapticTap(); onDone(); }}
              className="w-full py-3 text-sm font-semibold bg-[#1c1c1e] dark:bg-[#E5E5E5] text-white dark:text-[#0A0A0A] rounded-lg active:opacity-80 transition-opacity"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Study screen ───────────────────────────────────────────────────────
  return (
    <div className="min-h-[100dvh] flex flex-col bg-[var(--kit-bg)] text-[#1c1c1e] dark:text-[#E5E5E5] select-none">
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
          onClick={() => { hapticTap(); onDone(); }}
          className="text-sm font-medium text-[#1c1c1e] dark:text-[#E5E5E5] shrink-0"
        >
          ← Back
        </button>
        <span className="text-sm font-medium text-[#C4C4C4] truncate flex-1 text-center">
          {contextLabel ?? 'Review pass'}
        </span>
        <span className="text-xs text-[#C4C4C4] shrink-0 tabular-nums">
          {stats.remaining} left
        </span>
      </header>

      {/* No-scoring notice */}
      <div className="flex justify-center py-1.5 bg-[var(--kit-surface)] border-b border-[#E5E5E5] dark:border-[#262626]">
        <span className="text-[10px] font-medium text-[#C4C4C4] uppercase tracking-widest">
          Review pass — no scoring
        </span>
      </div>

      {/* Progress bar */}
      <div className="px-4 py-1">
        <div className="deck-progress-track bg-[#E5E5E5] dark:bg-[#262626] w-full">
          <div
            className="deck-progress-fill bg-[#1c1c1e] dark:bg-[#E5E5E5]"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
      </div>

      {/* Card area */}
      <div
        className="flex-1 min-h-0 relative overflow-hidden cursor-pointer"
        role="button"
        tabIndex={0}
        onClick={phase === 'front' ? flip : undefined}
        onKeyDown={e => { if ((e.key === ' ' || e.key === 'Enter') && phase === 'front') flip(); }}
      >
        {/* Front */}
        <div
          className={`absolute inset-0 flex items-center justify-center bg-[var(--kit-bg)] ${
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
                className="px-2 py-0.5 text-[10px] text-[#C4C4C4] bg-[var(--kit-surface)] border border-[#E5E5E5] dark:border-[#333] rounded-full"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Flip hint */}
        {phase === 'front' && (
          <div className="absolute bottom-4 left-0 right-0 flex justify-center pointer-events-none">
            <span className="text-xs text-[#C4C4C4] px-3 py-1 border border-[#E5E5E5] dark:border-[#404040] rounded-full">
              tap to flip
            </span>
          </div>
        )}
      </div>

      {/* Bottom bar */}
      <div
        className="shrink-0"
        style={{
          paddingTop: '0.75rem',
          paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))',
          paddingLeft: 'max(1rem, env(safe-area-inset-left))',
          paddingRight: 'max(1rem, env(safe-area-inset-right))',
        }}
      >
        {phase === 'back' ? (
          <div className="flex flex-col gap-2 py-3">
            {/* Repeat button */}
            <div className="flex justify-center">
              <button
                onClick={repeat}
                className="px-5 py-1.5 text-xs font-medium text-[#C4C4C4] border border-[#D4D4D4] dark:border-[#404040] rounded-full bg-[var(--kit-bg)] active:opacity-60 transition-opacity"
              >
                Repeat later
              </button>
            </div>
            {/* Action buttons */}
            <div className="flex gap-2">
              <button
                onClick={gotIt}
                className="flex-1 py-3 text-base font-semibold border border-[#D4D4D4] dark:border-[#404040] rounded-md text-[#1c1c1e] dark:text-[#E5E5E5] active:opacity-70 transition-opacity"
              >
                Got it
              </button>
            </div>
          </div>
        ) : (
          <div className="py-3">
            <div className="h-[52px]" />
          </div>
        )}
      </div>
    </div>
  );
}
