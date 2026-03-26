/**
 * useStudySession — state machine for a single study session.
 *
 * Responsibilities:
 *  - Load due cards for a deck from the database.
 *  - Track the current card, flip state, and session stats.
 *  - Handle ratings: FSRS + deck learning steps, write card_states + review_logs.
 *  - Support single-level undo: revert the last rating.
 *  - Emit haptic feedback via platform/haptics.ts.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Database } from 'sql.js';
import {
  deleteCardState,
  deleteReviewLog,
  getCardsDueForDeck,
  getCardsForStudyAhead,
  getDeckSettings,
  insertReviewLog,
  isLeech,
  setCardState,
  setCardSuspended,
  updateCardAfterReview,
} from '../lib/db/queries';
import {
  hapticAgain,
  hapticFlip,
  hapticSuccess,
  hapticUndo,
} from '../lib/platform/haptics';
import {
  intervalDaysUntilDue,
  resolveSchedule,
  shouldRequeueAfterRating,
  type DeckLearningSettings,
} from '../lib/srs/scheduleWithLearningSteps';
import { DEFAULT_PARAMS } from '../lib/srs/fsrs';
import type { Card, CardWithState, LearningState, Rating } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { persistDatabase } from './useDatabase';
import { scheduleICloudBackup } from './useBackup';

/** Whole days since last review (0 for first review). */
function calcElapsedDays(lastReview: number | null, nowSec: number): number {
  return lastReview ? Math.max(0, Math.floor((nowSec - lastReview) / 86400)) : 0;
}

/** All four rating buttons, used for preview computation. */
const ALL_RATINGS: Rating[] = ['again', 'hard', 'good', 'easy'];

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SessionStats {
  /** Unique cards rated at least once this session. */
  studied: number;
  /** Cards left in the queue (including current). */
  remaining: number;
  /** Wall-clock seconds elapsed since the session started. */
  elapsedSeconds: number;
  /** Remaining new cards in the queue. */
  newCount: number;
  /** Remaining learning/relearning cards in the queue. */
  learningCount: number;
  /** Remaining review cards in the queue. */
  reviewCount: number;
  /** Total times the Repeat button was used this session. */
  totalRepeats: number;
}

export type StudyPhase =
  | 'loading'
  | 'front'    // card visible, not yet flipped
  | 'back'     // card flipped, awaiting rating
  | 'complete' // no cards left
  | 'error';

/** Pre-computed scheduling preview for a single rating. */
export interface RatingPreview {
  /** Effective days until due (may be &lt; 1 for learning-minute steps). */
  scheduledDays: number;
}

export interface UseStudySessionReturn {
  phase: StudyPhase;
  /** HTML string for the card front (rendered by templateRenderer or raw). */
  frontHtml: string;
  /** HTML string for the card back. */
  backHtml: string;
  /** The card being studied right now, or null when loading/complete. */
  currentCard: Card | null;
  /** Learning state of the current card: new, learning, review, or relearning. */
  currentCardLearningState: LearningState | null;
  stats: SessionStats;
  errorMessage: string;
  /** Whether there is a rating in history that can be undone. */
  canUndo: boolean;
  /** Pre-computed next-interval previews for all 4 ratings (phase='back'). */
  ratingPreviews: Record<Rating, RatingPreview> | null;
  /** Total review cards loaded into the queue at session start. */
  totalDueReviews: number;
  /** Cards rated at least once this session — passed to Review Again. */
  studiedCards: Card[];
  /** Set briefly when a card hits the leech threshold; UI should show a warning. */
  leechCardId: string | null;
  /** Dismiss the leech warning. */
  dismissLeech: () => void;
  /** Flip the current card from front to back. */
  flip: () => void;
  /** Rate the current card; moves to the next card in the queue. */
  rate: (rating: Rating) => Promise<void>;
  /**
   * Re-insert the current card 5–10 positions later in the queue for extra
   * practice, then advance. No DB writes or FSRS scheduling.
   */
  repeat: () => void;
  /** Undo the last rating and return to the card that was just rated. */
  undo: () => Promise<void>;
  /** Trigger the long-press edit flow for the current card. */
  editCurrentCard: () => void;
  /** Replace the current card in the queue after an edit; re-displays the card. */
  updateCurrentCardInQueue: (updated: Card) => void;
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
   * If the card stayed in learning/relearning it was re-appended to the queue;
   * store the index so undo can remove it.
   */
  againInsertedAtIndex: number | null;
  /** True if this was the first time the card was rated this session (affects studied count). */
  isFirstRatingThisSession: boolean;
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
  studyAheadLimit = 0,
  sessionReviewLimit: number | null = null,
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
    newCount: 0,
    learningCount: 0,
    reviewCount: 0,
    totalRepeats: 0,
  });

  /** Card IDs rated at least once this session — used to count unique studied cards. */
  const ratedCardIdsRef = useRef<Set<string>>(new Set());
  /** Card objects rated at least once — used to build the Review Again queue. */
  const ratedCardsMapRef = useRef<Map<string, Card>>(new Map());

  const [ratingPreviews, setRatingPreviews] = useState<Record<Rating, RatingPreview> | null>(null);
  const [leechCardId, setLeechCardId] = useState<string | null>(null);
  const [totalDueReviews, setTotalDueReviews] = useState(0);

  /** Mutable queue — we push "again" cards to the end without re-rendering. */
  const queueRef = useRef<CardWithState[]>([]);
  /** Single-entry undo stack. */
  const undoRef = useRef<UndoEntry | null>(null);
  /** Cached deck learning settings — loaded once per session. */
  const deckSettingsRef = useRef<DeckLearningSettings>({
    againSteps: [1, 10],
    graduatingInterval: 1,
    easyInterval: 4,
  });
  /** Leech threshold (lapses count). 0 = disabled. */
  const leechThresholdRef = useRef(8);
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
    setFrontHtml(cws.card.front);
    setBackHtml(cws.card.back);
    setRatingPreviews(null);
    const remaining = queue.slice(index);
    setStats(prev => ({
      ...prev,
      remaining: remaining.length,
      newCount: remaining.filter(c => c.state.state === 'new').length,
      learningCount: remaining.filter(c => c.state.state === 'learning' || c.state.state === 'relearning').length,
      reviewCount: remaining.filter(c => c.state.state === 'review').length,
    }));
    setPhase('front');
  }, []);

  // -------------------------------------------------------------------------
  // Load due cards on mount / when db becomes available
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!db) return;

    setPhase('loading');
    startedAtRef.current = Date.now();
    undoRef.current = null;
    ratedCardIdsRef.current = new Set();
    ratedCardsMapRef.current = new Map();

    const now = Math.floor(Date.now() / 1000);

    // Cache deck settings for the entire session
    const deckResult = getDeckSettings(db, deckId);
    if (deckResult.success) {
      leechThresholdRef.current = deckResult.data.leechThreshold;
      deckSettingsRef.current = {
        againSteps: deckResult.data.againSteps,
        graduatingInterval: deckResult.data.graduatingInterval,
        easyInterval: deckResult.data.easyInterval,
        maxInterval: deckResult.data.maxInterval,
      };
    }

    const result = getCardsDueForDeck(db, deckId, now);

    if (!result.success) {
      setErrorMessage(result.error);
      setPhase('error');
      return;
    }

    let queue = result.data;

    // If no due cards and study-ahead mode, load upcoming review cards
    if (queue.length === 0 && studyAheadLimit > 0) {
      const aheadResult = getCardsForStudyAhead(db, deckId, now, studyAheadLimit);
      if (aheadResult.success) queue = aheadResult.data;
    }

    // Record how many review cards exist before limiting (for the picker UI).
    const reviewsInQueue = queue.filter(c => c.state.state === 'review').length;
    setTotalDueReviews(reviewsInQueue);

    // Apply per-session review cap: all new + learning cards pass through;
    // review cards are capped at sessionReviewLimit (most overdue are already
    // first in the queue due to ORDER BY due ASC in getCardsDueForDeck).
    if (sessionReviewLimit !== null && sessionReviewLimit >= 0) {
      let reviewsSeen = 0;
      queue = queue.filter(cws => {
        if (cws.state.state === 'review') {
          reviewsSeen++;
          return reviewsSeen <= sessionReviewLimit;
        }
        return true;
      });
    }

    queueRef.current = queue;

    if (queue.length === 0) {
      setStats({ studied: 0, remaining: 0, elapsedSeconds: 0, newCount: 0, learningCount: 0, reviewCount: 0, totalRepeats: 0 });
      setPhase('complete');
      return;
    }

    setStats({ studied: 0, remaining: queue.length, elapsedSeconds: 0, newCount: 0, learningCount: 0, reviewCount: 0, totalRepeats: 0 });
    showCard(queue, 0);
    setCurrentIndex(0);
    startTimer();

    return () => stopTimer();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, deckId, studyAheadLimit, sessionReviewLimit]);

  // -------------------------------------------------------------------------
  // flip
  // -------------------------------------------------------------------------

  const flip = useCallback(() => {
    if (phase !== 'front' || !db) return;
    hapticFlip();
    const cws = queueRef.current[currentIndex];
    if (!cws) return;
    setBackHtml(cws.card.back);

    const { state } = cws;
    const nowSec = Math.floor(Date.now() / 1000);
    const elapsedDays = calcElapsedDays(state.lastReview, nowSec);

    const deck = deckSettingsRef.current;
    const previews = {} as Record<Rating, RatingPreview>;
    const fsrsParams = { ...DEFAULT_PARAMS, requestRetention: deck.desiredRetention ?? 0.9 };
    for (const r of ALL_RATINGS) {
      const resolved = resolveSchedule(state, r, nowSec, elapsedDays, deck, fsrsParams);
      previews[r] = { scheduledDays: intervalDaysUntilDue(resolved, nowSec) };
    }
    setRatingPreviews(previews);
    setPhase('back');
  }, [phase, currentIndex, db]);

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

      const wasFirstReview = state.reps === 0;
      const isFirstRatingThisSession = !ratedCardIdsRef.current.has(card.id);
      const elapsedDays = calcElapsedDays(state.lastReview, nowSec);

      const fsrsParams = { ...DEFAULT_PARAMS, requestRetention: deckSettingsRef.current.desiredRetention ?? 0.9 };
      const resolved = resolveSchedule(state, rating, nowSec, elapsedDays, deckSettingsRef.current, fsrsParams);

      // --- DB writes ---
      const logId = uuidv4();

      const writeState = updateCardAfterReview(db, card.id, resolved, nowSec, elapsedDays);
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
        scheduledDays: resolved.scheduledDays,
      });
      if (!writeLog.success) {
        setErrorMessage(writeLog.error);
        setPhase('error');
        return;
      }

      // --- Persist ---
      persistDatabase();
      scheduleICloudBackup();

      // --- Haptics ---
      if (rating === 'again') hapticAgain();
      else hapticSuccess();

      // --- Leech detection ---
      if (rating === 'again' && isLeech(resolved.lapses, leechThresholdRef.current)) {
        const suspendResult = setCardSuspended(db, card.id, true);
        if (suspendResult.success) setLeechCardId(card.id);
      }

      // --- Re-queue learning/relearning so the card returns in this session ---
      let againInsertedAtIndex: number | null = null;
      if (shouldRequeueAfterRating(resolved) && writeState.success) {
        queue.push({ card, state: writeState.data });
        againInsertedAtIndex = queue.length - 1;
      }

      if (isFirstRatingThisSession) {
        ratedCardIdsRef.current.add(card.id);
        ratedCardsMapRef.current.set(card.id, card);
      }

      undoRef.current = {
        cardIndex: currentIndex,
        previousCardWithState: cws,
        wasFirstReview,
        reviewLogId: logId,
        againInsertedAtIndex,
        isFirstRatingThisSession,
      };

      // --- Advance ---
      const nextIndex = currentIndex + 1;

      setStats(prev => ({
        ...prev,
        studied: isFirstRatingThisSession ? prev.studied + 1 : prev.studied,
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
    [phase, db, deckId, currentIndex, showCard, stopTimer],
  );

  // -------------------------------------------------------------------------
  // undo
  // -------------------------------------------------------------------------

  const undo = useCallback(async () => {
    const entry = undoRef.current;
    if (!entry || !db) return;

    hapticUndo();

    const { cardIndex, previousCardWithState, wasFirstReview, reviewLogId, againInsertedAtIndex, isFirstRatingThisSession } =
      entry;

    // --- Revert DB ---
    if (wasFirstReview) {
      deleteCardState(db, previousCardWithState.card.id);
    } else {
      setCardState(db, previousCardWithState.state);
    }
    deleteReviewLog(db, reviewLogId);
    persistDatabase();
    scheduleICloudBackup();

    // --- Revert queue ---
    const queue = queueRef.current;
    if (againInsertedAtIndex !== null) {
      queue.splice(againInsertedAtIndex, 1);
    }

    if (isFirstRatingThisSession) {
      ratedCardIdsRef.current.delete(previousCardWithState.card.id);
      ratedCardsMapRef.current.delete(previousCardWithState.card.id);
    }
    undoRef.current = null;

    setStats(prev => ({
      ...prev,
      studied: isFirstRatingThisSession ? Math.max(0, prev.studied - 1) : prev.studied,
      remaining: queue.length - cardIndex,
    }));

    setCurrentIndex(cardIndex);
    showCard(queue, cardIndex);
    if (phase === 'complete') startTimer();
  }, [db, phase, showCard, startTimer]);

  // -------------------------------------------------------------------------
  // repeat
  // -------------------------------------------------------------------------

  const repeat = useCallback(() => {
    if (phase !== 'back') return;
    const queue = queueRef.current;
    const cws = queue[currentIndex];
    if (!cws) return;

    hapticUndo(); // soft light-impact

    // Insert a copy of the card 5–10 positions ahead (or at the end).
    const offset = 5 + Math.floor(Math.random() * 6);
    const insertAt = Math.min(currentIndex + offset, queue.length);
    queue.splice(insertAt, 0, { ...cws });

    // Clear undo — a repeat is not undoable.
    undoRef.current = null;

    const nextIndex = currentIndex + 1;

    setStats(prev => ({
      ...prev,
      remaining: queue.length - nextIndex,
      totalRepeats: prev.totalRepeats + 1,
    }));

    setCurrentIndex(nextIndex);
    showCard(queue, nextIndex);
  }, [phase, currentIndex, showCard]);

  // -------------------------------------------------------------------------
  // Expose onEditCard via long-press (called from Study.tsx, forwarded here)
  // The hook stores the callback so Study.tsx can call session.editCurrentCard().
  // -------------------------------------------------------------------------

  const editCurrentCard = useCallback(() => {
    const cws = queueRef.current[currentIndex];
    if (cws && onEditCard) onEditCard(cws.card);
  }, [currentIndex, onEditCard]);

  /** Replace the current card's data in the queue and re-display it. */
  const updateCurrentCardInQueue = useCallback(
    (updated: Card) => {
      const queue = queueRef.current;
      const cws = queue[currentIndex];
      if (!cws) return;
      queue[currentIndex] = { ...cws, card: updated };
      showCard(queue, currentIndex);
    },
    [currentIndex, showCard],
  );

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
    currentCardLearningState: queueRef.current[currentIndex]?.state.state ?? null,
    stats,
    errorMessage,
    canUndo: undoRef.current !== null,
    ratingPreviews,
    totalDueReviews,
    studiedCards: Array.from(ratedCardsMapRef.current.values()),
    leechCardId,
    dismissLeech: useCallback(() => setLeechCardId(null), []),
    flip,
    rate,
    repeat,
    undo,
    editCurrentCard,
    updateCurrentCardInQueue,
  };
}
