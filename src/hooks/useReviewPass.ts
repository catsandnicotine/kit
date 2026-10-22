/**
 * useReviewPass — drives a consequence-free review pass over a set of cards.
 *
 * No DB writes. No FSRS scheduling. Cards can be repeated 5–10 positions
 * later via the "Repeat" action, identical to the main study session.
 */

import { useCallback, useRef, useState } from 'react';
import type { Card } from '../types';
import { hapticFlip, hapticCelebration, hapticNavigate } from '../lib/platform/haptics';
import { v4 as uuidv4 } from 'uuid';
import { choosePractice, createPracticeQueue, navigatePractice, updatePracticeCard } from '../lib/practiceNavigation';
import type { PracticeChoice, PracticeDirection, PracticeQueue } from '../types/practiceNavigation';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ReviewPassPhase = 'front' | 'back' | 'complete';

export interface ReviewPassStats {
  /** Explicit Put aside choices; browsing past an unseen card does not count. */
  reviewed: number;
  /** Original cards supplied to this pass, including cards browsed without revealing. */
  total: number;
  /** Cards remaining in the current queue. */
  remaining: number;
  /** Total Repeat taps this pass. */
  totalRepeats: number;
}

export interface UseReviewPassReturn {
  phase: ReviewPassPhase;
  currentCard: Card | null;
  seenSessionKey: string;
  seenOccurrenceId: string | null;
  stats: ReviewPassStats;
  /** Turn between question and answer without advancing or recording a choice. */
  flip: () => void;
  /** Mark current card as done and advance. No scheduling change. */
  gotIt: () => void;
  /** Re-insert card 5–10 positions ahead, then advance. */
  repeat: () => void;
  /** Browse adjacent occurrences on their question without a choice or reveal. */
  previous: () => void;
  next: () => void;
  canPrevious: boolean;
  canNext: boolean;
  /** Historical choices are viewable, but cannot be applied twice or undone by browsing. */
  canChoose: boolean;
  updateCard: (card: Card) => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * @param initialCards - The set of cards to review (copied into a mutable queue).
 */
export function useReviewPass(initialCards: Card[]): UseReviewPassReturn {
  const [queue, setQueue] = useState(() => createPracticeQueue(initialCards));
  const queueRef = useRef(queue);
  const [seenSessionKey] = useState(() => uuidv4());
  const [phase, setPhase] = useState<ReviewPassPhase>(
    initialCards.length > 0 ? 'front' : 'complete',
  );
  const phaseRef = useRef(phase);
  const advance = useCallback((next: PracticeQueue, celebrate = false) => {
    if (next === queueRef.current) return;
    queueRef.current = next;
    setQueue(next);
    phaseRef.current = next.index >= next.entries.length ? 'complete' : 'front';
    setPhase(phaseRef.current);
    if (celebrate && phaseRef.current === 'complete') void hapticCelebration();
  }, []);

  const flip = useCallback(() => {
    if (phaseRef.current !== 'front' && phaseRef.current !== 'back') return;
    hapticFlip();
    phaseRef.current = phaseRef.current === 'front' ? 'back' : 'front';
    setPhase(phaseRef.current);
  }, []);

  const choose = useCallback((choice: PracticeChoice) => {
    if (phaseRef.current !== 'back') return;
    advance(choosePractice(queueRef.current, choice, uuidv4(), 5 + Math.floor(Math.random() * 6)), true);
  }, [advance]);

  const navigate = useCallback((direction: PracticeDirection) => {
    if (phaseRef.current !== 'front' && phaseRef.current !== 'back' && !(phaseRef.current === 'complete' && direction === 'previous')) return;
    const next = navigatePractice(queueRef.current, direction);
    if (next === queueRef.current) return;
    hapticNavigate();
    advance(next);
  }, [advance]);

  const updateCard = useCallback((updated: Card) => {
    queueRef.current = updatePracticeCard(queueRef.current, updated);
    setQueue(queueRef.current);
  }, []);

  const current = phase !== 'complete' ? queue.entries[queue.index] : undefined;

  return {
    phase,
    currentCard: current?.card ?? null,
    seenSessionKey,
    seenOccurrenceId: current?.occurrenceId ?? null,
    stats: { reviewed:queue.putAside, total:queue.initialCount, remaining:queue.remaining, totalRepeats:queue.repeats },
    flip,
    gotIt: () => choose('aside'),
    repeat: () => choose('again'),
    previous: () => navigate('previous'),
    next: () => navigate('next'),
    canPrevious: queue.entries.length > 0 && queue.index > 0,
    canNext: Boolean(current),
    canChoose: current?.choice === null,
    updateCard,
  };
}
