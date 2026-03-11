/**
 * Study page — full-screen spaced-repetition study view.
 *
 * Layout:
 *  ┌──────────────────────────┐
 *  │  header: deck name + stats│
 *  │  progress bar            │
 *  ├──────────────────────────┤
 *  │                          │
 *  │   card content (tap area)│
 *  │                          │
 *  ├──────────────────────────┤
 *  │  rating buttons / prompt │
 *  └──────────────────────────┘
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Database } from 'sql.js';
import type { Card, Rating } from '../types';
import {
  useStudySession,
  type UseStudySessionReturnExtended,
} from '../hooks/useStudySession';
import { hapticLongPress } from '../lib/platform/haptics';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface StudyProps {
  db: Database | null;
  deckId: string;
  deckName?: string;
  onEditCard?: (card: Card) => void;
  onExit?: () => void;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Thin progress bar at the top of the study view. */
function ProgressBar({ studied, total }: { studied: number; total: number }) {
  const pct = total === 0 ? 100 : Math.round((studied / total) * 100);
  return (
    <div className="w-full h-0.5 bg-border-light dark:bg-border-dark">
      <div
        className="h-full bg-accent-light dark:bg-accent-dark transition-all duration-300"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/** Rating button with colour coding. */
function RatingButton({
  label,
  onClick,
  color,
}: {
  label: string;
  onClick: () => void;
  color: 'red' | 'orange' | 'green' | 'blue';
}) {
  const colorMap: Record<string, string> = {
    red: 'border-red-500 text-red-500 dark:border-red-400 dark:text-red-400',
    orange: 'border-orange-400 text-orange-400 dark:border-orange-300 dark:text-orange-300',
    green: 'border-green-500 text-green-500 dark:border-green-400 dark:text-green-400',
    blue: 'border-blue-500 text-blue-500 dark:border-blue-400 dark:text-blue-400',
  };

  return (
    <button
      onClick={onClick}
      className={`rating-btn flex-1 py-3 text-sm font-semibold tracking-wide border rounded-md transition-colors active:opacity-70 ${colorMap[color]}`}
    >
      {label}
    </button>
  );
}

/** Card content rendered from HTML string. */
function CardContent({ html, visible }: { html: string; visible: boolean }) {
  return (
    <div
      className={`card-face card-content w-full h-full overflow-auto p-6 ${visible ? '' : 'card-face-hidden'}`}
      // The HTML comes from the Anki template renderer — a sandboxed, trusted source.
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/** Session complete view. */
function SessionComplete({
  studied,
  elapsedSeconds,
  onExit,
}: {
  studied: number;
  elapsedSeconds: number;
  onExit?: () => void;
}) {
  const mins = Math.floor(elapsedSeconds / 60);
  const secs = elapsedSeconds % 60;
  const timeStr =
    mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 px-8 text-center">
      <p className="text-4xl">🐱</p>
      <h2 className="text-xl font-semibold text-text-light dark:text-text-dark">
        Session complete
      </h2>
      <p className="text-sm text-text-muted">
        {studied} {studied === 1 ? 'card' : 'cards'} reviewed in {timeStr}
      </p>
      {onExit && (
        <button
          onClick={onExit}
          className="mt-4 px-6 py-2 border border-border-light dark:border-border-dark text-text-light dark:text-text-dark text-sm rounded-md"
        >
          Done
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Long-press hook
// ---------------------------------------------------------------------------

const LONG_PRESS_MS = 500;

function useLongPress(onLongPress: () => void) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);

  const start = useCallback(() => {
    cancelledRef.current = false;
    timerRef.current = setTimeout(() => {
      if (!cancelledRef.current) {
        hapticLongPress();
        onLongPress();
      }
    }, LONG_PRESS_MS);
  }, [onLongPress]);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  return {
    onPointerDown: start,
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerMove: cancel,
  };
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * Full-screen study view for one deck.
 *
 * @param db        - sql.js Database instance (null while loading).
 * @param deckId    - UUID of the deck to study.
 * @param deckName  - Human-readable deck name for the header.
 * @param onEditCard - Called when the user long-presses the card.
 * @param onExit    - Called when the user dismisses the session-complete screen.
 */
export default function Study({ db, deckId, deckName, onEditCard, onExit }: StudyProps) {
  const session = useStudySession(db, deckId, onEditCard) as UseStudySessionReturnExtended;
  const { phase, frontHtml, backHtml, stats, errorMessage, canUndo, flip, rate, undo } = session;

  // Track total cards for the progress bar (set once on load).
  const [totalCards, setTotalCards] = useState(0);
  useEffect(() => {
    if (phase === 'front' && totalCards === 0) {
      setTotalCards(stats.studied + stats.remaining);
    }
  }, [phase, stats.studied, stats.remaining, totalCards]);

  const longPressProps = useLongPress(session.editCurrentCard);

  // ── DEBUG ──────────────────────────────────────────────────────────────────
  console.debug('[Study] render — phase:', phase, '| frontHtml length:', frontHtml.length, '| backHtml length:', backHtml.length);
  // ────────────────────────────────────────────────────────────────────────────

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  if (phase === 'loading') {
    return (
      <div className="flex items-center justify-center h-screen bg-background-light dark:bg-background-dark text-text-light dark:text-text-dark">
        <p className="text-text-muted text-sm">Loading…</p>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4 px-8 text-center bg-background-light dark:bg-background-dark text-text-light dark:text-text-dark">
        <p className="text-sm text-red-500">{errorMessage}</p>
        {onExit && (
          <button onClick={onExit} className="text-sm text-text-muted underline">
            Go back
          </button>
        )}
      </div>
    );
  }

  if (phase === 'complete') {
    return (
      <div className="h-screen bg-background-light dark:bg-background-dark text-text-light dark:text-text-dark">
        <SessionComplete
          studied={stats.studied}
          elapsedSeconds={stats.elapsedSeconds}
          onExit={onExit}
        />
      </div>
    );
  }

  const studied = stats.studied;
  const total = totalCards || studied + stats.remaining;

  return (
    <div className="flex flex-col h-screen bg-background-light dark:bg-background-dark text-text-light dark:text-text-dark select-none">
      {/* ── Header ── */}
      <header className="flex items-center justify-between px-4 pt-safe-top pb-2 shrink-0">
        <span className="text-xs text-text-muted truncate max-w-[60%]">
          {deckName ?? 'Study'}
        </span>
        <span className="text-xs text-text-muted tabular-nums">
          {stats.remaining} left
        </span>
      </header>

      {/* ── Progress bar ── */}
      <ProgressBar studied={studied} total={total} />

      {/* ── Card area ── */}
      <div
        className="flex-1 relative overflow-hidden cursor-pointer"
        role="button"
        tabIndex={0}
        aria-label={phase === 'front' ? 'Tap to reveal answer' : 'Card answer'}
        onClick={phase === 'front' ? flip : undefined}
        onKeyDown={e => {
          if (e.key === ' ' || e.key === 'Enter') {
            if (phase === 'front') flip();
          }
        }}
        {...(phase !== 'back' ? longPressProps : {})}
      >
        {/* Front */}
        <div
          className={`absolute inset-0 flex items-center justify-center card-face ${
            phase === 'front' ? '' : 'card-face-hidden'
          }`}
        >
          <CardContent html={frontHtml} visible={phase === 'front'} />
        </div>

        {/* Back */}
        <div
          className={`absolute inset-0 flex items-center justify-center card-face ${
            phase === 'back' ? '' : 'card-face-hidden'
          }`}
        >
          <CardContent html={backHtml} visible={phase === 'back'} />
        </div>

        {/* Tap-to-flip prompt overlay (only on front) */}
        {phase === 'front' && (
          <div className="absolute bottom-4 left-0 right-0 flex justify-center pointer-events-none">
            <span className="text-xs text-text-muted px-3 py-1 border border-border-light dark:border-border-dark rounded-full">
              tap to flip
            </span>
          </div>
        )}
      </div>

      {/* ── Bottom bar ── */}
      <div className="shrink-0 px-4 pb-safe-bottom">
        {phase === 'back' ? (
          <div className="flex flex-col gap-2 py-3">
            {/* Rating buttons */}
            <div className="flex gap-2">
              <RatingButton label="Again" onClick={() => rate('again')} color="red" />
              <RatingButton label="Hard" onClick={() => rate('hard')} color="orange" />
              <RatingButton label="Good" onClick={() => rate('good')} color="green" />
              <RatingButton label="Easy" onClick={() => rate('easy')} color="blue" />
            </div>

            {/* Undo */}
            {canUndo && (
              <button
                onClick={undo}
                className="w-full py-2 text-xs text-text-muted"
              >
                Undo last rating
              </button>
            )}
          </div>
        ) : (
          /* Spacer so layout doesn't shift */
          <div className="py-3">
            <div className="h-[52px]" />
          </div>
        )}
      </div>

      {/* ── Stats ticker (bottom-left) ── */}
      <div className="absolute bottom-[calc(env(safe-area-inset-bottom)+4rem)] left-4 pointer-events-none">
        <span className="text-[10px] text-text-muted tabular-nums">
          {formatTime(stats.elapsedSeconds)}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
