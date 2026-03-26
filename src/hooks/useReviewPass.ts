/**
 * useReviewPass — drives a consequence-free review pass over a set of cards.
 *
 * No DB writes. No FSRS scheduling. Cards can be repeated 5–10 positions
 * later via the "Repeat" action, identical to the main study session.
 */

import { useCallback, useRef, useState } from 'react';
import type { Card } from '../types';
import { hapticFlip, hapticTap, hapticUndo } from '../lib/platform/haptics';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ReviewPassPhase = 'front' | 'back' | 'complete';

export interface ReviewPassStats {
  /** Cards that have been advanced past (Got it taps). */
  reviewed: number;
  /** Cards remaining in the current queue. */
  remaining: number;
  /** Total Repeat taps this pass. */
  totalRepeats: number;
}

export interface UseReviewPassReturn {
  phase: ReviewPassPhase;
  currentCard: Card | null;
  stats: ReviewPassStats;
  /** Flip the current card to show the back. */
  flip: () => void;
  /** Mark current card as done and advance. No scheduling change. */
  gotIt: () => void;
  /** Re-insert card 5–10 positions ahead, then advance. */
  repeat: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * @param initialCards - The set of cards to review (copied into a mutable queue).
 */
export function useReviewPass(initialCards: Card[]): UseReviewPassReturn {
  const queueRef = useRef<Card[]>([...initialCards]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [phase, setPhase] = useState<ReviewPassPhase>(
    initialCards.length > 0 ? 'front' : 'complete',
  );
  const [stats, setStats] = useState<ReviewPassStats>({
    reviewed: 0,
    remaining: initialCards.length,
    totalRepeats: 0,
  });

  const advance = useCallback(
    (nextIndex: number, extraRepeat = false) => {
      const queue = queueRef.current;
      setStats(prev => ({
        ...prev,
        reviewed: prev.reviewed + (extraRepeat ? 0 : 1),
        remaining: Math.max(0, queue.length - nextIndex),
        totalRepeats: prev.totalRepeats + (extraRepeat ? 1 : 0),
      }));
      if (nextIndex >= queue.length) {
        setPhase('complete');
      } else {
        setCurrentIndex(nextIndex);
        setPhase('front');
      }
    },
    [],
  );

  const flip = useCallback(() => {
    if (phase !== 'front') return;
    hapticFlip();
    setPhase('back');
  }, [phase]);

  const gotIt = useCallback(() => {
    if (phase !== 'back') return;
    hapticTap();
    advance(currentIndex + 1);
  }, [phase, currentIndex, advance]);

  const repeat = useCallback(() => {
    if (phase !== 'back') return;
    hapticUndo();
    const queue = queueRef.current;
    const card = queue[currentIndex];
    if (!card) return;
    const offset = 5 + Math.floor(Math.random() * 6);
    const insertAt = Math.min(currentIndex + offset, queue.length);
    queue.splice(insertAt, 0, { ...card });
    advance(currentIndex + 1, true);
  }, [phase, currentIndex, advance]);

  return {
    phase,
    currentCard: queueRef.current[currentIndex] ?? null,
    stats,
    flip,
    gotIt,
    repeat,
  };
}
