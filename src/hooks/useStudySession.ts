/**
 * useStudySession — state machine for a single study session.
 *
 * Responsibilities:
 *  - Load due cards for a deck from the database.
 *  - Track the current card, flip state, and session stats.
 *  - Handle ratings: run FSRS, write card_states + review_logs.
 *  - Support single-level undo: revert the last rating.
 *  - Emit haptic feedback via platform/haptics.ts.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Database } from 'sql.js';
import {
  deleteCardState,
  deleteReviewLog,
  getCardsDueForDeck,
  insertReviewLog,
  setCardState,
  updateCardAfterReview,
} from '../lib/db/queries';
import {
  hapticAgain,
  hapticFlip,
  hapticSuccess,
  hapticUndo,
} from '../lib/platform/haptics';
import { initializeCard, reviewCard } from '../lib/srs/fsrs';
import type { Card, CardState, CardWithState, Rating } from '../types';
import { v4 as uuidv4 } from 'uuid';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SessionStats {
  /** Cards rated at least once this session. */
  studied: number;
  /** Cards left in the queue (including current). */
  remaining: number;
  /** Wall-clock seconds elapsed since the session started. */
  elapsedSeconds: number;
}

export type StudyPhase =
  | 'loading'
  | 'front'    // card visible, not yet flipped
  | 'back'     // card flipped, awaiting rating
  | 'complete' // no cards left
  | 'error';

export interface UseStudySessionReturn {
  phase: StudyPhase;
  /** HTML string for the card front (rendered by templateRenderer or raw). */
  frontHtml: string;
  /** HTML string for the card back. */
  backHtml: string;
  /** The card being studied right now, or null when loading/complete. */
  currentCard: Card | null;
  stats: SessionStats;
  errorMessage: string;
  /** Whether there is a rating in history that can be undone. */
  canUndo: boolean;
  /** Flip the current card from front to back. */
  flip: () => void;
  /** Rate the current card; moves to the next card in the queue. */
  rate: (rating: Rating) => Promise<void>;
  /** Undo the last rating and return to the card that was just rated. */
  undo: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface UndoEntry {
  /** Index in the *original* queue array of the card that was rated. */
  cardIndex: number;
  /** The CardWithState *before* the rating was applied. */
  previousCardWithState: CardWithState;
  /** True if card_states row did not exist before this rating. */
  wasFirstReview: boolean;
  /** ID of the review_log row written for this rating. */
  reviewLogId: string;
  /**
   * If the card was rated "again" it was re-inserted at the end of the queue;
   * store the re-inserted index so we can remove it on undo.
   */
  againInsertedAtIndex: number | null;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Drive a complete study session for one deck.
 *
 * @param db       - sql.js Database, or null while the DB is still loading.
 * @param deckId   - UUID of the deck being studied.
 * @param onEditCard - Optional callback invoked when the user long-presses a card.
 * @returns State and action callbacks for the Study UI.
 */
export function useStudySession(
  db: Database | null,
  deckId: string,
  onEditCard?: (card: Card) => void,
): UseStudySessionReturn {
  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------

  const [phase, setPhase] = useState<StudyPhase>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [frontHtml, setFrontHtml] = useState('');
  const [backHtml, setBackHtml] = useState('');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [stats, setStats] = useState<SessionStats>({
    studied: 0,
    remaining: 0,
    elapsedSeconds: 0,
  });

  /** Mutable queue — we push "again" cards to the end without re-rendering. */
  const queueRef = useRef<CardWithState[]>([]);
  /** Single-entry undo stack. */
  const undoRef = useRef<UndoEntry | null>(null);
  /** Session start timestamp (ms). */
  const startedAtRef = useRef<number>(Date.now());
  /** Interval handle for the elapsed-seconds ticker. */
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  const stopTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startTimer = useCallback(() => {
    stopTimer();
    timerRef.current = setInterval(() => {
      setStats(prev => ({
        ...prev,
        elapsedSeconds: Math.floor((Date.now() - startedAtRef.current) / 1000),
      }));
    }, 1000);
  }, [stopTimer]);

  /** Display the card at `index` in the queue; phase → 'front'. */
  const showCard = useCallback((queue: CardWithState[], index: number) => {
    const cws = queue[index];
    if (!cws) return;
    // ── DEBUG ──────────────────────────────────────────────────────────────
    console.debug('[showCard] index:', index, '| frontHtml length:', cws.card.front.length, '| backHtml length:', cws.card.back.length);
    // ───────────────────────────────────────────────────────────────────────
    setFrontHtml(cws.card.front);
    setBackHtml(cws.card.back);
    setStats(prev => ({
      ...prev,
      remaining: queue.length - index,
    }));
    setPhase('front');
  }, []);

  // -------------------------------------------------------------------------
  // Load due cards on mount / when db becomes available
  // -------------------------------------------------------------------------

  useEffect(() => {
    // ── DEBUG ────────────────────────────────────────────────────────────────
    console.debug('[useStudySession] effect fired — db:', db ? 'present' : 'null', '| deckId:', deckId);
    // ─────────────────────────────────────────────────────────────────────────

    if (!db) return;

    setPhase('loading');
    startedAtRef.current = Date.now();
    undoRef.current = null;

    const result = getCardsDueForDeck(db, deckId, Math.floor(Date.now() / 1000));

    // ── DEBUG ────────────────────────────────────────────────────────────────
    console.debug('[useStudySession] getCardsDueForDeck result:', result.success ? `${result.data.length} cards` : `ERROR: ${result.error}`);
    if (result.success && result.data.length > 0) {
      const first = result.data[0].card;
      console.debug('[useStudySession] first card front (first 120 chars):', first.front.slice(0, 120));
      console.debug('[useStudySession] first card back  (first 120 chars):', first.back.slice(0, 120));
    }
    // ─────────────────────────────────────────────────────────────────────────

    if (!result.success) {
      setErrorMessage(result.error);
      setPhase('error');
      return;
    }

    const queue = result.data;
    queueRef.current = queue;

    if (queue.length === 0) {
      setStats({ studied: 0, remaining: 0, elapsedSeconds: 0 });
      setPhase('complete');
      return;
    }

    setStats({ studied: 0, remaining: queue.length, elapsedSeconds: 0 });
    showCard(queue, 0);
    setCurrentIndex(0);
    startTimer();

    return () => stopTimer();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, deckId]);

  // -------------------------------------------------------------------------
  // flip
  // -------------------------------------------------------------------------

  const flip = useCallback(() => {
    if (phase !== 'front') return;
    hapticFlip();
    setBackHtml(queueRef.current[currentIndex]?.card.back ?? '');
    setPhase('back');
  }, [phase, currentIndex]);

  // -------------------------------------------------------------------------
  // rate
  // -------------------------------------------------------------------------

  const rate = useCallback(
    async (rating: Rating) => {
      if (phase !== 'back' || !db) return;

      const queue = queueRef.current;
      const cws = queue[currentIndex];
      if (!cws) return;

      const nowSec = Math.floor(Date.now() / 1000);
      const { card, state } = cws;

      // --- FSRS ---
      const wasFirstReview = state.reps === 0;
      const elapsedDays = state.lastReview
        ? Math.max(0, Math.floor((nowSec - state.lastReview) / 86400))
        : 0;

      const fsrsOutput = wasFirstReview
        ? initializeCard(rating)
        : reviewCard(state, rating, elapsedDays);

      // --- DB writes ---
      const logId = uuidv4();

      const writeState = updateCardAfterReview(db, card.id, fsrsOutput, nowSec, elapsedDays);
      if (!writeState.success) {
        setErrorMessage(writeState.error);
        setPhase('error');
        return;
      }

      const writeLog = insertReviewLog(db, {
        id: logId,
        cardId: card.id,
        rating,
        reviewedAt: nowSec,
        elapsed: elapsedDays,
        scheduledDays: fsrsOutput.scheduledDays,
      });
      if (!writeLog.success) {
        setErrorMessage(writeLog.error);
        setPhase('error');
        return;
      }

      // --- Haptics ---
      if (rating === 'again') hapticAgain();
      else hapticSuccess();

      // --- Undo entry ---
      let againInsertedAtIndex: number | null = null;
      if (rating === 'again') {
        // Re-append the card at the end so it comes up again.
        queue.push({ card, state });
        againInsertedAtIndex = queue.length - 1;
      }

      undoRef.current = {
        cardIndex: currentIndex,
        previousCardWithState: cws,
        wasFirstReview,
        reviewLogId: logId,
        againInsertedAtIndex,
      };

      // --- Advance ---
      const nextIndex = currentIndex + 1;

      setStats(prev => ({
        ...prev,
        studied: prev.studied + 1,
        remaining: queue.length - nextIndex,
      }));

      if (nextIndex >= queue.length) {
        stopTimer();
        setPhase('complete');
      } else {
        setCurrentIndex(nextIndex);
        showCard(queue, nextIndex);
      }
    },
    [phase, db, currentIndex, showCard, stopTimer],
  );

  // -------------------------------------------------------------------------
  // undo
  // -------------------------------------------------------------------------

  const undo = useCallback(async () => {
    const entry = undoRef.current;
    if (!entry || !db) return;

    hapticUndo();

    const { cardIndex, previousCardWithState, wasFirstReview, reviewLogId, againInsertedAtIndex } =
      entry;

    // --- Revert DB ---
    if (wasFirstReview) {
      deleteCardState(db, previousCardWithState.card.id);
    } else {
      setCardState(db, previousCardWithState.state);
    }
    deleteReviewLog(db, reviewLogId);

    // --- Revert queue ---
    const queue = queueRef.current;
    if (againInsertedAtIndex !== null) {
      queue.splice(againInsertedAtIndex, 1);
    }

    undoRef.current = null;

    setStats(prev => ({
      ...prev,
      studied: Math.max(0, prev.studied - 1),
      remaining: queue.length - cardIndex,
    }));

    setCurrentIndex(cardIndex);
    showCard(queue, cardIndex);
    if (phase === 'complete') startTimer();
  }, [db, phase, showCard, startTimer]);

  // -------------------------------------------------------------------------
  // Expose onEditCard via long-press (called from Study.tsx, forwarded here)
  // The hook stores the callback so Study.tsx can call session.editCurrentCard().
  // -------------------------------------------------------------------------

  const editCurrentCard = useCallback(() => {
    const cws = queueRef.current[currentIndex];
    if (cws && onEditCard) onEditCard(cws.card);
  }, [currentIndex, onEditCard]);

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  useEffect(() => {
    return () => stopTimer();
  }, [stopTimer]);

  // -------------------------------------------------------------------------
  // Return
  // -------------------------------------------------------------------------

  return {
    phase,
    frontHtml,
    backHtml,
    currentCard: queueRef.current[currentIndex]?.card ?? null,
    stats,
    errorMessage,
    canUndo: undoRef.current !== null,
    flip,
    rate,
    undo,
    // editCurrentCard is used internally by Study.tsx — not part of the public
    // interface type, but we cast below so the page can access it.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...(({ editCurrentCard } as any)),
  };
}

export type UseStudySessionReturnExtended = UseStudySessionReturn & {
  editCurrentCard: () => void;
};
