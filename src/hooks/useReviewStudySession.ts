/**
 * useReviewStudySession — drives a physical-flashcard style review session.
 *
 * No DB writes. No FSRS scheduling. Cards are shuffled randomly on load.
 * Three actions: send to back of deck, send to middle, or put aside.
 *
 * @param db     - sql.js Database instance (null while loading).
 * @param deckId - Deck UUID to load cards from.
 * @returns Session state and action callbacks.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Database } from 'sql.js';
import type { Card } from '../types';
import { getCardsByDeck } from '../lib/db/queries';
import { hapticFlip, hapticTap, hapticUndo, hapticCelebration } from '../lib/platform/haptics';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ReviewStudyPhase = 'loading' | 'front' | 'back' | 'complete';

export interface ReviewStudyStats {
  /** Total cards loaded from the deck. */
  total: number;
  /** Cards remaining in the active queue. */
  remaining: number;
  /** Cards put aside (removed from queue). */
  putAside: number;
}

export interface UseReviewStudySessionReturn {
  phase: ReviewStudyPhase;
  currentCard: Card | null;
  stats: ReviewStudyStats;
  /** Flip the current card to show the back. */
  flip: () => void;
  /** Move current card to the end of the queue. */
  sendToBack: () => void;
  /** Insert current card at a random position in the middle of the queue. */
  sendToMiddle: () => void;
  /** Remove current card from the queue entirely. */
  putAside: () => void;
  /** Reshuffle put-aside cards for another round. */
  reshufflePutAside: () => void;
}

// ---------------------------------------------------------------------------
// Fisher-Yates shuffle
// ---------------------------------------------------------------------------

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = a[i] as T;
    a[i] = a[j] as T;
    a[j] = tmp;
  }
  return a;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useReviewStudySession(
  db: Database | null,
  deckId: string,
): UseReviewStudySessionReturn {
  const queueRef = useRef<Card[]>([]);
  const putAsideRef = useRef<Card[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [phase, setPhase] = useState<ReviewStudyPhase>('loading');
  const [stats, setStats] = useState<ReviewStudyStats>({
    total: 0,
    remaining: 0,
    putAside: 0,
  });

  // ── Load & shuffle cards ────────────────────────────────────────────────
  useEffect(() => {
    if (!db) return;

    const result = getCardsByDeck(db, deckId);
    if (!result.success || result.data.length === 0) {
      setPhase('complete');
      return;
    }

    const shuffled = shuffle(result.data);
    queueRef.current = shuffled;
    putAsideRef.current = [];
    setCurrentIndex(0);
    setStats({ total: shuffled.length, remaining: shuffled.length, putAside: 0 });
    setPhase('front');
  }, [db, deckId]);

  // ── Helpers ─────────────────────────────────────────────────────────────

  const advance = useCallback(() => {
    const queue = queueRef.current;
    const next = currentIndex + 1;
    const remaining = Math.max(0, queue.length - next);
    setStats(prev => ({ ...prev, remaining }));

    if (next >= queue.length) {
      setPhase('complete');
    } else {
      setCurrentIndex(next);
      setPhase('front');
    }
  }, [currentIndex]);

  // ── Actions ─────────────────────────────────────────────────────────────

  const flip = useCallback(() => {
    if (phase !== 'front') return;
    hapticFlip();
    setPhase('back');
  }, [phase]);

  const sendToBack = useCallback(() => {
    if (phase !== 'back') return;
    hapticUndo();
    const queue = queueRef.current;
    const card = queue[currentIndex];
    if (!card) return;
    // Push a copy to the end
    queue.push({ ...card });
    advance();
  }, [phase, currentIndex, advance]);

  const sendToMiddle = useCallback(() => {
    if (phase !== 'back') return;
    hapticTap();
    const queue = queueRef.current;
    const card = queue[currentIndex];
    if (!card) return;
    // Insert at a random position in the middle 50% of the remaining queue
    const remaining = queue.length - (currentIndex + 1);
    if (remaining <= 1) {
      // Too few cards — just push to end
      queue.push({ ...card });
    } else {
      const lo = currentIndex + 1 + Math.floor(remaining * 0.25);
      const hi = currentIndex + 1 + Math.floor(remaining * 0.75);
      const insertAt = lo + Math.floor(Math.random() * (hi - lo + 1));
      queue.splice(insertAt, 0, { ...card });
    }
    advance();
  }, [phase, currentIndex, advance]);

  const putAside = useCallback(() => {
    if (phase !== 'back') return;
    hapticTap();
    const queue = queueRef.current;
    const card = queue[currentIndex];
    if (card) putAsideRef.current.push(card);
    setStats(prev => ({ ...prev, putAside: putAsideRef.current.length }));
    // Don't re-add to queue — just advance
    const next = currentIndex + 1;
    const remaining = Math.max(0, queue.length - next);
    setStats(prev => ({ ...prev, remaining, putAside: putAsideRef.current.length }));
    if (next >= queue.length) {
      setPhase('complete');
    } else {
      setCurrentIndex(next);
      setPhase('front');
    }
  }, [phase, currentIndex]);

  const reshufflePutAside = useCallback(() => {
    if (putAsideRef.current.length === 0) return;
    hapticCelebration();
    const shuffled = shuffle(putAsideRef.current);
    queueRef.current = shuffled;
    putAsideRef.current = [];
    setCurrentIndex(0);
    setStats({ total: shuffled.length, remaining: shuffled.length, putAside: 0 });
    setPhase('front');
  }, []);

  // ── Return ──────────────────────────────────────────────────────────────

  const currentCard = phase !== 'loading' && phase !== 'complete'
    ? queueRef.current[currentIndex] ?? null
    : null;

  return {
    phase,
    currentCard,
    stats,
    flip,
    sendToBack,
    sendToMiddle,
    putAside,
    reshufflePutAside,
  };
}
