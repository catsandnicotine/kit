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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Database } from 'sql.js';
import type { Card, Rating } from '../types';
import {
  useStudySession,
  type UseStudySessionReturnExtended,
} from '../hooks/useStudySession';
import { useDeckMedia } from '../hooks/useDeckMedia';
import { hapticLongPress, hapticTap, hapticNavigate } from '../lib/platform/haptics';
import { getDeckStats } from '../lib/db/queries';
import { CardEditor } from '../components/CardEditor';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface StudyProps {
  db: Database | null;
  deckId: string;
  deckName?: string;
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

/**
 * Play an ordered list of audio elements one at a time. The first starts
 * immediately; each subsequent track begins when the previous one ends.
 *
 * @returns Cleanup function that stops playback and removes listeners.
 */
function playAudioSequentially(audios: HTMLAudioElement[]): () => void {
  if (audios.length === 0) return () => {};

  let currentIdx = 0;
  let cancelled = false;
  const cleanups: (() => void)[] = [];

  function playNext() {
    if (cancelled || currentIdx >= audios.length) return;
    const audio = audios[currentIdx];
    const onEnded = () => {
      currentIdx++;
      playNext();
    };
    audio.addEventListener('ended', onEnded, { once: true });
    cleanups.push(() => audio.removeEventListener('ended', onEnded));

    audio.currentTime = 0;
    audio.play().catch(() => {
      // Autoplay blocked — the user can tap the native controls instead.
      // Still chain to the next so a manual play→end still advances.
    });
  }

  playNext();

  return () => {
    cancelled = true;
    for (const fn of cleanups) fn();
    for (const audio of audios) audio.pause();
  };
}

/**
 * Card content rendered from HTML string.
 *
 * Uses a ref to only update innerHTML when the html prop *value* actually
 * changes — not on every React re-render. This prevents timer-driven
 * re-renders (the 1-second elapsed-time ticker) from tearing down and
 * recreating the DOM, which would restart any in-progress <audio> playback.
 *
 * Audio playback:
 *  - Multiple audio files play sequentially, not simultaneously.
 *  - Only the first track auto-plays; the rest wait for the previous to end.
 *  - A "Replay" button appears when there is audio, letting the user replay
 *    the full sequence.
 */
function CardContent({ html, visible }: { html: string; visible: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const currentHtmlRef = useRef('');
  const stopPlaybackRef = useRef<(() => void) | null>(null);
  const [hasAudio, setHasAudio] = useState(false);

  /** Collect audio elements from the container in DOM order. */
  const getAudios = useCallback((): HTMLAudioElement[] => {
    const el = containerRef.current;
    if (!el) return [];
    return Array.from(el.querySelectorAll<HTMLAudioElement>('audio'));
  }, []);

  /** Stop any in-progress sequential playback. */
  const stopCurrent = useCallback(() => {
    stopPlaybackRef.current?.();
    stopPlaybackRef.current = null;
  }, []);

  /** Start sequential playback of all audio in this card face. */
  const startPlayback = useCallback(() => {
    stopCurrent();
    const audios = getAudios();
    if (audios.length === 0) return;
    stopPlaybackRef.current = playAudioSequentially(audios);
  }, [getAudios, stopCurrent]);

  // -- HTML injection & initial playback --
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    if (currentHtmlRef.current === html) return;
    currentHtmlRef.current = html;

    // Stop & clean up old audio before replacing DOM.
    stopCurrent();
    const oldAudios = el.querySelectorAll<HTMLAudioElement>('audio');
    for (const audio of oldAudios) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }

    el.innerHTML = html;

    const audios = getAudios();
    setHasAudio(audios.length > 0);

    if (visible && audios.length > 0) {
      stopPlaybackRef.current = playAudioSequentially(audios);
    }

    return stopCurrent;
  }, [html, visible, getAudios, stopCurrent]);

  // -- Visibility transitions --
  const prevVisibleRef = useRef(visible);
  useEffect(() => {
    const wasVisible = prevVisibleRef.current;
    prevVisibleRef.current = visible;

    if (visible && !wasVisible) {
      // Face just became visible — start sequential playback.
      startPlayback();
    } else if (!visible && wasVisible) {
      // Face hidden — silence everything.
      stopCurrent();
      for (const audio of getAudios()) audio.pause();
    }
  }, [visible, startPlayback, stopCurrent, getAudios]);

  return (
    <div className={`card-face card-content w-full h-full overflow-auto p-6 ${visible ? '' : 'card-face-hidden'}`}>
      <div ref={containerRef} />
      {visible && hasAudio && (
        <button
          type="button"
          onClick={startPlayback}
          className="anki-replay-btn"
        >
          Replay Audio
        </button>
      )}
    </div>
  );
}

/** Session complete view. */
function SessionComplete({
  studied,
  elapsedSeconds,
  nextDueLabel,
  onExit,
}: {
  studied: number;
  elapsedSeconds: number;
  nextDueLabel: string | null;
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
        {studied > 0 ? 'Session complete' : 'No cards due'}
      </h2>
      {studied > 0 ? (
        <p className="text-sm text-text-muted">
          {studied} {studied === 1 ? 'card' : 'cards'} reviewed in {timeStr}
        </p>
      ) : (
        <p className="text-sm text-text-muted">
          You're all caught up!
        </p>
      )}
      {nextDueLabel && (
        <p className="text-xs text-text-muted">
          Next review {nextDueLabel}
        </p>
      )}
      {onExit && (
        <button
          onClick={() => { hapticTap(); onExit(); }}
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
export default function Study({ db, deckId, deckName, onExit }: StudyProps) {
  const [editingCard, setEditingCard] = useState<Card | null>(null);
  const [nextDueLabel, setNextDueLabel] = useState<string | null>(null);

  const handleEditCard = useCallback((card: Card) => {
    setEditingCard(card);
  }, []);

  const session = useStudySession(db, deckId, handleEditCard) as UseStudySessionReturnExtended;
  const { phase, frontHtml, backHtml, stats, errorMessage, canUndo, flip, rate, undo } = session;
  const { rewriteHtml } = useDeckMedia(db, deckId);

  // Compute next due label when session completes
  useEffect(() => {
    if (phase !== 'complete' || !db) return;
    const now = Math.floor(Date.now() / 1000);
    const result = getDeckStats(db, deckId, now);
    if (result.success && result.data.nextDue) {
      const diff = result.data.nextDue - now;
      if (diff <= 0) {
        setNextDueLabel('now');
      } else if (diff < 60) {
        setNextDueLabel('in less than a minute');
      } else if (diff < 3600) {
        const mins = Math.round(diff / 60);
        setNextDueLabel(`in ${mins} ${mins === 1 ? 'minute' : 'minutes'}`);
      } else if (diff < 86400) {
        const hours = Math.round(diff / 3600);
        setNextDueLabel(`in ${hours} ${hours === 1 ? 'hour' : 'hours'}`);
      } else {
        const days = Math.round(diff / 86400);
        setNextDueLabel(`in ${days} ${days === 1 ? 'day' : 'days'}`);
      }
    }
  }, [phase, db, deckId]);

  /** After the editor saves, update the card in the study queue and refresh. */
  const handleEditorSave = useCallback(
    (updated: Card) => {
      session.updateCurrentCardInQueue(updated);
      setEditingCard(null);
    },
    [session],
  );

  const handleEditorDelete = useCallback(() => {
    setEditingCard(null);
    // Card was deleted — exit back to home since the queue is now stale.
    onExit?.();
  }, [onExit]);

  // Rewrite media src attributes (e.g. src="cat.jpg") to blob: object URLs.
  // Memoized so the 1-second elapsed-time ticker doesn't re-run the regex work.
  const resolvedFront = useMemo(() => rewriteHtml(frontHtml), [rewriteHtml, frontHtml]);
  const resolvedBack = useMemo(() => rewriteHtml(backHtml), [rewriteHtml, backHtml]);

  // Track total cards for the progress bar (set once on load).
  const [totalCards, setTotalCards] = useState(0);
  useEffect(() => {
    if (phase === 'front' && totalCards === 0) {
      setTotalCards(stats.studied + stats.remaining);
    }
  }, [phase, stats.studied, stats.remaining, totalCards]);

  const longPressProps = useLongPress(session.editCurrentCard);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  if (phase === 'loading') {
    return (
      <div className="flex flex-col h-screen bg-background-light dark:bg-background-dark text-text-light dark:text-text-dark">
        <header className="px-4 pt-safe-top pb-2 shrink-0">
          <button onClick={() => { hapticTap(); onExit?.(); }} className="text-xs text-text-muted">&larr; Back</button>
        </header>
        <div className="flex-1 flex items-center justify-center">
          <p className="text-text-muted text-sm">Loading…</p>
        </div>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="flex flex-col h-screen bg-background-light dark:bg-background-dark text-text-light dark:text-text-dark">
        <header className="px-4 pt-safe-top pb-2 shrink-0">
          <button onClick={() => { hapticTap(); onExit?.(); }} className="text-xs text-text-muted">&larr; Back</button>
        </header>
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-8 text-center">
          <p className="text-sm text-red-500">{errorMessage}</p>
        </div>
      </div>
    );
  }

  if (phase === 'complete') {
    return (
      <div className="flex flex-col h-screen bg-background-light dark:bg-background-dark text-text-light dark:text-text-dark">
        <header className="px-4 pt-safe-top pb-2 shrink-0">
          <button onClick={() => { hapticTap(); onExit?.(); }} className="text-xs text-text-muted">&larr; Back</button>
        </header>
        <div className="flex-1">
          <SessionComplete
            studied={stats.studied}
            elapsedSeconds={stats.elapsedSeconds}
            nextDueLabel={nextDueLabel}
            onExit={onExit}
          />
        </div>
      </div>
    );
  }

  const studied = stats.studied;
  const total = totalCards || studied + stats.remaining;

  return (
    <div className="flex flex-col h-screen bg-background-light dark:bg-background-dark text-text-light dark:text-text-dark select-none">
      {/* ── Header ── */}
      <header className="flex items-center gap-3 px-4 pt-safe-top pb-2 shrink-0">
        <button onClick={() => { hapticTap(); onExit?.(); }} className="text-xs text-text-muted shrink-0">
          &larr; Back
        </button>
        <span className="text-xs text-text-muted truncate flex-1">
          {deckName ?? 'Study'}
        </span>
        <span className="text-xs text-text-muted tabular-nums shrink-0">
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
        {...longPressProps}
      >
        {/* Front */}
        <div
          className={`absolute inset-0 flex items-center justify-center card-face ${
            phase === 'front' ? '' : 'card-face-hidden'
          }`}
        >
          <CardContent html={resolvedFront} visible={phase === 'front'} />
        </div>

        {/* Back */}
        <div
          className={`absolute inset-0 flex items-center justify-center card-face ${
            phase === 'back' ? '' : 'card-face-hidden'
          }`}
        >
          <CardContent html={resolvedBack} visible={phase === 'back'} />
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

            {/* Edit + Undo row */}
            <div className="flex items-center justify-between">
              <button
                onClick={() => { hapticTap(); session.editCurrentCard(); }}
                className="py-2 text-xs text-text-muted"
              >
                Edit
              </button>
              {canUndo ? (
                <button
                  onClick={undo}
                  className="py-2 text-xs text-text-muted"
                >
                  Undo
                </button>
              ) : (
                <span />
              )}
            </div>
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

      {/* ── Card Editor overlay ── */}
      {editingCard && (
        <CardEditor
          db={db}
          card={editingCard}
          onSave={handleEditorSave}
          onDelete={handleEditorDelete}
          onDismiss={() => setEditingCard(null)}
        />
      )}
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
