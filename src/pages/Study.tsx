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
import type { Card } from '../types';
import { useStudySession } from '../hooks/useStudySession';
import { ReviewPassView } from '../components/ReviewPassView';
import { useDeckMedia } from '../hooks/useDeckMedia';
import { useTheme } from '../hooks/useTheme';
import { hapticLongPress, hapticTap } from '../lib/platform/haptics';
import { getDeckStats, getTagsForDeck, type TagCount } from '../lib/db/queries';
import { renderImageOcclusion } from '../lib/imageOcclusion';
import { renderMath } from '../lib/renderMath';
import { CardEditor } from '../components/CardEditor';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface StudyProps {
  db: Database | null;
  deckId: string;
  deckName?: string;
  onExit?: () => void;
  /** Callback to emit sync edit operations (new per-deck architecture). */
  onSyncEdit?: ((ops: import('../lib/sync/types').EditOp[]) => void) | undefined;
  /** Called when the study session completes (all cards reviewed). */
  onSessionComplete?: () => void;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------


/** Progress bar. */
function ProgressBar({ studied, total }: { studied: number; total: number }) {
  const progress = total === 0 ? 1 : studied / total;
  const pct = Math.round(progress * 100);
  return (
    <div className="px-4 py-1">
      <div className="deck-progress-track bg-[#E5E5E5] dark:bg-[#262626] w-full">
        <div
          className="deck-progress-fill bg-[#1c1c1e] dark:bg-[#E5E5E5]"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Format a scheduled interval in days to a human-readable short string.
 *
 * @param days - Interval in days.
 * @returns Formatted string like "<1m", "10m", "1h", "1d", "3d", "2w", "2mo".
 */
function formatInterval(days: number): string {
  const minutes = days * 24 * 60;
  if (minutes < 1) return '<1m';
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.round(hours)}h`;
  if (days < 14) return `${Math.round(days)}d`;
  const weeks = days / 7;
  if (weeks < 8) return `${Math.round(weeks)}w`;
  const months = days / 30;
  return `${Math.round(months)}mo`;
}

const RATING_COLOR_MAP: Record<string, string> = {
  red: 'border-[#D4D4D4] dark:border-[#404040] text-[#1c1c1e] dark:text-[#E5E5E5]',
  orange: 'border-[#D4D4D4] dark:border-[#404040] text-[#1c1c1e] dark:text-[#E5E5E5]',
  green: 'border-[#D4D4D4] dark:border-[#404040] text-[#1c1c1e] dark:text-[#E5E5E5]',
  blue: 'border-[#D4D4D4] dark:border-[#404040] text-[#1c1c1e] dark:text-[#E5E5E5]',
};

/** Rating button with colour coding and optional interval display. */
function RatingButton({
  label,
  onClick,
  color,
  interval,
}: {
  label: string;
  onClick: () => void;
  color: 'red' | 'orange' | 'green' | 'blue';
  interval?: string | undefined;
}) {
  return (
    <button
      onClick={onClick}
      className={`rating-btn flex-1 py-3 text-base font-semibold tracking-wide border rounded-md transition-colors active:opacity-70 flex flex-col items-center gap-0.5 ${RATING_COLOR_MAP[color]}`}
    >
      <span>{label}</span>
      {interval && <span className="text-sm font-normal opacity-70">{interval}</span>}
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
    if (!audio) return;
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
 *
 * The HTML is wrapped to match Anki's DOM structure:
 *   <div class="night_mode">   ← body-level classes (dark/black modes)
 *     <div class="card">       ← card-level wrapper (deck CSS targets this)
 *       ...content...
 *     </div>
 *   </div>
 *
 * This lets deck CSS rules like `.night_mode .card { ... }` work naturally.
 */
function CardContent({ html, visible, bodyClass }: { html: string; visible: boolean; bodyClass: string }) {
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

    const outerOpen = bodyClass ? `<div class="${bodyClass}">` : '';
    const outerClose = bodyClass ? '</div>' : '';
    const fullHtml = `${outerOpen}<div class="card">${html}</div>${outerClose}`;
    if (currentHtmlRef.current === fullHtml) return;
    currentHtmlRef.current = fullHtml;

    // Stop & clean up old audio before replacing DOM.
    stopCurrent();
    const oldAudios = el.querySelectorAll<HTMLAudioElement>('audio');
    for (const audio of oldAudios) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }

    el.innerHTML = fullHtml;

    const audios = getAudios();
    setHasAudio(audios.length > 0);

    if (visible && audios.length > 0) {
      stopPlaybackRef.current = playAudioSequentially(audios);
    }

    return stopCurrent;
  }, [html, visible, bodyClass, getAudios, stopCurrent]);

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
    <div
      className={`card-face card-content w-full h-full min-h-0 overflow-auto ${visible ? '' : 'card-face-hidden'}`}
      style={{
        padding: 'max(1.5rem, env(safe-area-inset-top)) max(1.5rem, env(safe-area-inset-right)) max(1.5rem, env(safe-area-inset-bottom)) max(1.5rem, env(safe-area-inset-left))',
      }}
    >
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

/** Study-ahead quick-pick options (card counts). */
const STUDY_AHEAD_OPTIONS = [5, 10, 20] as const;

/** Session complete view — matches the app's section-card layout. */
function SessionComplete({
  studied,
  elapsedSeconds,
  totalRepeats,
  nextDueLabel,
  onExit,
  onReviewAgain,
  onStudyAhead,
  isStudyAhead,
}: {
  studied: number;
  elapsedSeconds: number;
  totalRepeats: number;
  nextDueLabel: string | null;
  onExit?: () => void;
  onReviewAgain?: () => void;
  onStudyAhead?: (limit: number) => void;
  isStudyAhead: boolean;
}) {
  const mins = Math.floor(elapsedSeconds / 60);
  const secs = elapsedSeconds % 60;
  const timeStr =
    mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  return (
    <div
      className="flex-1 overflow-auto"
      style={{
        paddingBottom: 'max(1rem, env(safe-area-inset-bottom))',
        paddingLeft: 'max(1rem, env(safe-area-inset-left))',
        paddingRight: 'max(1rem, env(safe-area-inset-right))',
      }}
    >
      {/* Title area */}
      <div className="flex flex-col items-center gap-2 pt-8 pb-6">
        <h2 className="text-base font-bold text-[#1c1c1e] dark:text-[#E5E5E5]">
          {studied > 0 ? 'Session complete' : 'No cards due'}
        </h2>
      </div>

      {/* Review Again */}
      {studied > 0 && onReviewAgain && (
        <div className="px-4 pb-4">
          <button
            onClick={() => { hapticTap(); onReviewAgain(); }}
            className="w-full py-3 text-sm font-semibold border border-[#D4D4D4] dark:border-[#404040] rounded-lg text-[#1c1c1e] dark:text-[#E5E5E5] active:bg-[#F0F0F0] dark:active:bg-[#1A1A1A] transition-colors"
          >
            Review Again
          </button>
        </div>
      )}

      {/* Stats card */}
      <section className="px-4 pb-4">
        <div className="bg-[var(--kit-surface)] border border-[#E5E5E5] dark:border-[#262626] rounded-lg p-4 flex flex-col gap-2">
          {studied > 0 ? (
            <div className="flex justify-between text-sm">
              <span className="text-[#C4C4C4]">Reviewed</span>
              <span className="font-medium">{studied} {studied === 1 ? 'card' : 'cards'} in {timeStr}</span>
            </div>
          ) : (
            <p className="text-sm text-[#C4C4C4]">You're all caught up!</p>
          )}
          {totalRepeats > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-[#C4C4C4]">Repeated</span>
              <span className="font-medium">{totalRepeats} {totalRepeats === 1 ? 'time' : 'times'}</span>
            </div>
          )}
          {nextDueLabel && (
            <div className="flex justify-between text-sm">
              <span className="text-[#C4C4C4]">Next review</span>
              <span className="font-medium">{nextDueLabel}</span>
            </div>
          )}
        </div>
      </section>

      {/* Study ahead card */}
      {!isStudyAhead && onStudyAhead && (
        <section className="px-4 pb-4">
          <div className="bg-[var(--kit-surface)] border border-[#E5E5E5] dark:border-[#262626] rounded-lg p-4">
            <p className="text-sm font-medium mb-3">Study ahead</p>
            <div className="flex gap-2 mb-2">
              {STUDY_AHEAD_OPTIONS.map((n) => (
                <button
                  key={n}
                  onClick={() => { hapticTap(); onStudyAhead(n); }}
                  className="flex-1 py-2 text-sm font-semibold border border-[#D4D4D4] dark:border-[#404040] rounded-lg text-[#1c1c1e] dark:text-[#E5E5E5] active:bg-[#F0F0F0] dark:active:bg-[#1A1A1A] transition-colors"
                >
                  {n}
                </button>
              ))}
            </div>
            <StudyAheadCustom onStudyAhead={onStudyAhead} />
          </div>
        </section>
      )}

      {/* Done button */}
      {onExit && (
        <div className="px-4 pt-2">
          <button
            onClick={() => { hapticTap(); onExit(); }}
            className="w-full py-3 text-sm font-semibold bg-[#1c1c1e] dark:bg-[#E5E5E5] text-white dark:text-[#0A0A0A] rounded-lg active:opacity-80 transition-opacity"
          >
            Done
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Bottom-sheet picker for limiting review cards in the current session.
 * Tapping "All" removes the limit; tapping a number caps review cards at that value.
 */
function ReviewLimitPicker({
  totalDueReviews,
  currentLimit,
  onSelect,
  onDismiss,
}: {
  totalDueReviews: number;
  currentLimit: number | null;
  onSelect: (limit: number | null) => void;
  onDismiss: () => void;
}) {
  const quickOptions = [10, 20, 30, 50, 100].filter(n => n < totalDueReviews);

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30"
        onClick={onDismiss}
      />
      {/* Sheet */}
      <div
        className="relative bg-[var(--kit-surface)] rounded-t-2xl shadow-xl"
        style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-4">
          <div className="w-10 h-1 rounded-full bg-[#D4D4D4] dark:bg-[#404040]" />
        </div>

        <div className="px-4 pb-2">
          <p className="text-sm font-semibold mb-0.5">Limit review cards</p>
          <p className="text-xs text-[#C4C4C4]">{totalDueReviews} due · new and learning cards always show</p>
        </div>

        {/* Quick options */}
        <div className="px-4 pt-3 pb-1 flex flex-wrap gap-2">
          <button
            onClick={() => onSelect(null)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold border transition-colors ${
              currentLimit === null
                ? 'bg-[#1c1c1e] dark:bg-[#E5E5E5] text-white dark:text-[#0A0A0A] border-[#1c1c1e] dark:border-[#E5E5E5]'
                : 'border-[#D4D4D4] dark:border-[#404040] text-[#1c1c1e] dark:text-[#E5E5E5] active:bg-[#F0F0F0] dark:active:bg-[#1A1A1A]'
            }`}
          >
            All ({totalDueReviews})
          </button>
          {quickOptions.map(n => (
            <button
              key={n}
              onClick={() => onSelect(n)}
              className={`px-4 py-2 rounded-lg text-sm font-semibold border transition-colors ${
                currentLimit === n
                  ? 'bg-[#1c1c1e] dark:bg-[#E5E5E5] text-white dark:text-[#0A0A0A] border-[#1c1c1e] dark:border-[#E5E5E5]'
                  : 'border-[#D4D4D4] dark:border-[#404040] text-[#1c1c1e] dark:text-[#E5E5E5] active:bg-[#F0F0F0] dark:active:bg-[#1A1A1A]'
              }`}
            >
              {n}
            </button>
          ))}
        </div>

        {/* Cancel */}
        <div className="px-4 pt-3">
          <button
            onClick={onDismiss}
            className="w-full py-3 text-sm font-semibold border border-[#D4D4D4] dark:border-[#404040] rounded-lg text-[#1c1c1e] dark:text-[#E5E5E5] active:bg-[#F0F0F0] dark:active:bg-[#1A1A1A] transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/** Custom card count input for study ahead. */
function StudyAheadCustom({ onStudyAhead }: { onStudyAhead: (n: number) => void }) {
  const [custom, setCustom] = useState('');

  const handleCustom = () => {
    const n = parseInt(custom, 10);
    if (n > 0) { hapticTap(); onStudyAhead(n); }
  };

  return (
    <div className="flex gap-2">
      <input
        type="number"
        min={1}
        max={9999}
        placeholder="Custom"
        value={custom}
        onChange={e => setCustom(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') handleCustom(); }}
        className="flex-1 text-center text-sm bg-[#F0F0F0] dark:bg-[#262626] border border-[#D4D4D4] dark:border-[#404040] rounded-lg px-3 py-2 text-[#1c1c1e] dark:text-[#E5E5E5] outline-none"
      />
      <button
        onClick={handleCustom}
        className="px-4 py-2 text-sm font-semibold border border-[#D4D4D4] dark:border-[#404040] rounded-lg text-[#1c1c1e] dark:text-[#E5E5E5] active:bg-[#F0F0F0] dark:active:bg-[#1A1A1A] transition-colors"
      >
        Go
      </button>
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
export default function Study({ db, deckId, deckName, onExit, onSyncEdit, onSessionComplete }: StudyProps) {
  const [editingCard, setEditingCard] = useState<Card | null>(null);
  const [nextDueLabel, setNextDueLabel] = useState<string | null>(null);
  const [studyAheadLimit, setStudyAheadLimit] = useState(0);
  const [reviewPassCards, setReviewPassCards] = useState<Card[] | null>(null);

  const handleEditCard = useCallback((card: Card) => {
    setEditingCard(card);
  }, []);

  const [sessionReviewLimit, setSessionReviewLimit] = useState<number | null>(null);
  const [showReviewPicker, setShowReviewPicker] = useState(false);
  const [deckTags, setDeckTags] = useState<TagCount[]>([]);

  useEffect(() => {
    if (!db) return;
    const result = getTagsForDeck(db, deckId);
    if (result.success) setDeckTags(result.data);
  }, [db, deckId]);

  const session = useStudySession(db, deckId, handleEditCard, studyAheadLimit, sessionReviewLimit, onSyncEdit);
  const {
    phase, frontHtml, backHtml, stats, errorMessage, canUndo, ratingPreviews,
    totalDueReviews, studiedCards, currentCardLearningState,
    flip, rate, repeat, undo, editCurrentCard, updateCurrentCardInQueue,
  } = session;
  const { rewriteHtml, addMediaFile } = useDeckMedia(db, deckId);
  const { theme } = useTheme();

  // Build class strings for the Anki-compatible card wrapper.
  // Anki's DOM: <body class="night_mode"><div class="card">...</div></body>
  // We replicate: <div class="night_mode"><div class="card">...</div></div>
  // so deck CSS like `.night_mode .card { color: white }` works naturally.
  const bodyClass = useMemo(() => {
    const classes: string[] = [];
    if (theme === 'dark' || theme === 'black') classes.push('night_mode');
    if (theme === 'black') classes.push('black_mode');
    return classes.join(' ');
  }, [theme]);

  // Notify parent when session completes (triggers compaction + registry save)
  useEffect(() => {
    if (phase === 'complete') {
      onSessionComplete?.();
    }
  }, [phase, onSessionComplete]);

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
      updateCurrentCardInQueue(updated);
      setEditingCard(null);
    },
    [updateCurrentCardInQueue],
  );

  const handleEditorDelete = useCallback(() => {
    setEditingCard(null);
    // Card was deleted — exit back to home since the queue is now stale.
    onExit?.();
  }, [onExit]);

  // Rewrite media src attributes (e.g. src="cat.jpg") to blob: object URLs,
  // then render Image Occlusion masks if present.
  // Memoized so the 1-second elapsed-time ticker doesn't re-run the regex work.
  const resolvedFront = useMemo(
    () => renderMath(renderImageOcclusion(rewriteHtml(frontHtml), 'front')),
    [rewriteHtml, frontHtml],
  );
  const resolvedBack = useMemo(
    () => renderMath(renderImageOcclusion(rewriteHtml(backHtml), 'back')),
    [rewriteHtml, backHtml],
  );

  // Track total cards for the progress bar (set once on load).
  const [totalCards, setTotalCards] = useState(0);
  useEffect(() => {
    if (phase === 'front' && totalCards === 0) {
      setTotalCards(stats.studied + stats.remaining);
    }
  }, [phase, stats.studied, stats.remaining, totalCards]);

  const longPressProps = useLongPress(editCurrentCard);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  // Review-again pass — renders instead of normal study UI, no DB writes
  if (reviewPassCards) {
    return (
      <ReviewPassView
        cards={reviewPassCards}
        {...(deckName !== undefined ? { contextLabel: deckName } : {})}
        rewriteHtml={rewriteHtml}
        onDone={() => setReviewPassCards(null)}
      />
    );
  }

  if (phase === 'loading') {
    return (
      <div className="flex flex-col min-h-[100dvh] bg-[var(--kit-bg)] text-text-light dark:text-text-dark">
        <header
          className="flex items-center gap-3 shrink-0"
          style={{
            paddingTop: 'calc(env(safe-area-inset-top) + 0.75rem)',
            paddingBottom: '0.5rem',
            paddingLeft: 'max(1rem, env(safe-area-inset-left))',
            paddingRight: 'max(1rem, env(safe-area-inset-right))',
          }}
        >
          <button
            onClick={() => { hapticTap(); onExit?.(); }}
            className="p-2 -ml-2 text-[#C4C4C4] hover:text-[#1c1c1e] dark:hover:text-[#E5E5E5] transition-colors shrink-0"
            aria-label="Back"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
        </header>
        <div className="flex-1 flex items-center justify-center">
          <p className="text-text-muted text-sm">Loading…</p>
        </div>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="flex flex-col min-h-[100dvh] bg-[var(--kit-bg)] text-text-light dark:text-text-dark">
        <header
          className="flex items-center gap-3 shrink-0"
          style={{
            paddingTop: 'calc(env(safe-area-inset-top) + 0.75rem)',
            paddingBottom: '0.5rem',
            paddingLeft: 'max(1rem, env(safe-area-inset-left))',
            paddingRight: 'max(1rem, env(safe-area-inset-right))',
          }}
        >
          <button
            onClick={() => { hapticTap(); onExit?.(); }}
            className="p-2 -ml-2 text-[#C4C4C4] hover:text-[#1c1c1e] dark:hover:text-[#E5E5E5] transition-colors shrink-0"
            aria-label="Back"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
        </header>
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-8 text-center">
          <p className="text-sm text-red-500">{errorMessage}</p>
        </div>
      </div>
    );
  }

  if (phase === 'complete') {
    return (
      <div className="flex flex-col min-h-[100dvh] bg-[var(--kit-bg)] text-[#1c1c1e] dark:text-[#E5E5E5]">
        <header
          className="flex items-center gap-3 pb-3 border-b border-[#E5E5E5] dark:border-[#262626] shrink-0"
          style={{
            paddingTop: 'calc(env(safe-area-inset-top) + 0.75rem)',
            paddingLeft: 'max(1rem, env(safe-area-inset-left))',
            paddingRight: 'max(1rem, env(safe-area-inset-right))',
          }}
        >
          <button
            onClick={() => { hapticTap(); onExit?.(); }}
            className="p-2 -ml-2 text-[#C4C4C4] hover:text-[#1c1c1e] dark:hover:text-[#E5E5E5] transition-colors shrink-0"
            aria-label="Back"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
          <span className="text-sm font-semibold truncate">
            {deckName ?? 'Study'}
          </span>
        </header>
        <SessionComplete
          studied={stats.studied}
          elapsedSeconds={stats.elapsedSeconds}
          totalRepeats={stats.totalRepeats}
          nextDueLabel={nextDueLabel}
          isStudyAhead={studyAheadLimit > 0}
          onStudyAhead={(limit: number) => setStudyAheadLimit(limit)}
          {...(studiedCards.length > 0 ? { onReviewAgain: () => setReviewPassCards(studiedCards) } : {})}
          {...(onExit && { onExit })}
        />
      </div>
    );
  }

  const studied = stats.studied;
  const total = totalCards || studied + stats.remaining;

  return (
    <div className="flex flex-col min-h-[100dvh] bg-[var(--kit-bg)] text-text-light dark:text-text-dark select-none">
      {/* ── Header ── */}
      <header
        className="flex items-center gap-3 shrink-0 border-b border-border-light dark:border-border-dark"
        style={{
          paddingTop: 'calc(env(safe-area-inset-top) + 0.75rem)',
          paddingBottom: '0.5rem',
          paddingLeft: 'max(1rem, env(safe-area-inset-left))',
          paddingRight: 'max(1rem, env(safe-area-inset-right))',
        }}
      >
        <button
          onClick={() => { hapticTap(); onExit?.(); }}
          className="p-2 -ml-2 text-[#C4C4C4] hover:text-[#1c1c1e] dark:hover:text-[#E5E5E5] transition-colors shrink-0"
          aria-label="Back"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
        </button>
        <span className="text-sm font-medium text-[#C4C4C4] dark:text-[#C4C4C4] truncate flex-1 text-center">
          {deckName ?? 'Study'}
        </span>
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-1.5 text-sm font-semibold tabular-nums">
            <span className={`text-blue-500 px-1.5 py-0.5 rounded ${(phase === 'front' || phase === 'back') && currentCardLearningState === 'new' ? 'bg-blue-500/15' : ''}`}>{stats.newCount}</span>
            <span className={`text-red-500 px-1.5 py-0.5 rounded ${(phase === 'front' || phase === 'back') && (currentCardLearningState === 'learning' || currentCardLearningState === 'relearning') ? 'bg-red-500/15' : ''}`}>{stats.learningCount}</span>
            <button
              onClick={() => { if (totalDueReviews > 0) { hapticTap(); setShowReviewPicker(true); } }}
              className={`text-green-500 px-1.5 py-0.5 rounded ${(phase === 'front' || phase === 'back') && currentCardLearningState === 'review' ? 'bg-green-500/15' : ''}`}
              aria-label="Limit review cards this session"
            >
              {sessionReviewLimit !== null
                ? `${stats.reviewCount}/${sessionReviewLimit}`
                : stats.reviewCount}
            </button>
          </div>
        </div>
      </header>

      {/* ── Progress bar ── */}
      <ProgressBar studied={studied} total={total} />

      {/* ── Card area ── */}
      <div
        className="flex-1 min-h-0 relative overflow-hidden cursor-pointer flex flex-col"
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
          className={`absolute inset-0 flex items-center justify-center card-face bg-[var(--kit-bg)] ${
            phase === 'front' ? '' : 'card-face-hidden'
          }`}
        >
          <CardContent html={resolvedFront} visible={phase === 'front'} bodyClass={bodyClass} />
        </div>

        {/* Back */}
        <div
          className={`absolute inset-0 flex items-center justify-center card-face bg-[var(--kit-bg)] ${
            phase === 'back' ? '' : 'card-face-hidden'
          }`}
        >
          <CardContent html={resolvedBack} visible={phase === 'back'} bodyClass={bodyClass} />
        </div>

        {/* Tag pills — shown on back */}
        {phase === 'back' && session.currentCard && session.currentCard.tags.length > 0 && (
          <div className="absolute bottom-4 left-0 right-0 flex flex-wrap justify-center gap-1.5 px-4 pointer-events-none">
            {session.currentCard.tags.map(tag => (
              <span
                key={tag}
                className="px-2 py-0.5 text-[10px] text-[#C4C4C4] bg-[var(--kit-surface)] border border-[#E5E5E5] dark:border-[#333] rounded-full"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Tap-to-flip prompt overlay (only on front) */}
        {phase === 'front' && (
          <div className="absolute bottom-4 left-0 right-0 flex justify-center pointer-events-none">
            <span className="text-xs text-[#C4C4C4] dark:text-[#C4C4C4] px-3 py-1 border border-[#E5E5E5] dark:border-[#404040] rounded-full">
              tap to flip
            </span>
          </div>
        )}
      </div>

      {/* ── Bottom bar (rating buttons) ── */}
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
            {/* Repeat button — extra practice, no scheduling */}
            <div className="flex justify-center">
              <button
                onClick={repeat}
                className="px-5 py-1.5 text-xs font-medium text-[#C4C4C4] border border-[#D4D4D4] dark:border-[#404040] rounded-full bg-[var(--kit-bg)] active:opacity-60 transition-opacity"
              >
                Repeat later
              </button>
            </div>

            {/* Rating buttons */}
            <div className="flex gap-2">
              <RatingButton label="Again" onClick={() => rate('again')} color="red" interval={ratingPreviews ? formatInterval(ratingPreviews.again.scheduledDays) : undefined} />
              <RatingButton label="Hard" onClick={() => rate('hard')} color="orange" interval={ratingPreviews ? formatInterval(ratingPreviews.hard.scheduledDays) : undefined} />
              <RatingButton label="Good" onClick={() => rate('good')} color="green" interval={ratingPreviews ? formatInterval(ratingPreviews.good.scheduledDays) : undefined} />
              <RatingButton label="Easy" onClick={() => rate('easy')} color="blue" interval={ratingPreviews ? formatInterval(ratingPreviews.easy.scheduledDays) : undefined} />
            </div>

            {/* Edit + Undo row */}
            <div className="flex items-center justify-between">
              <button
                onClick={() => { hapticTap(); editCurrentCard(); }}
                className="py-2 text-xs text-text-muted"
              >
                Edit
              </button>
              {canUndo && (
                <button
                  onClick={undo}
                  className="py-2 text-xs text-text-muted"
                >
                  Undo
                </button>
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

      {/* ── Card Editor overlay ── */}
      {editingCard && (
        <CardEditor
          db={db}
          card={editingCard}
          rewriteHtml={rewriteHtml}
          deckTags={deckTags}
          onSave={handleEditorSave}
          onDelete={handleEditorDelete}
          onDismiss={() => setEditingCard(null)}
          onMediaAdded={addMediaFile}
          onSyncEdit={onSyncEdit}
        />
      )}

      {/* ── Review limiter picker ── */}
      {showReviewPicker && (
        <ReviewLimitPicker
          totalDueReviews={totalDueReviews}
          currentLimit={sessionReviewLimit}
          onSelect={(limit) => {
            hapticTap();
            setSessionReviewLimit(limit);
            setShowReviewPicker(false);
          }}
          onDismiss={() => { hapticTap(); setShowReviewPicker(false); }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
