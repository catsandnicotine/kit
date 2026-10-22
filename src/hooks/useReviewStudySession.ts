/**
 * useReviewStudySession — drives a physical-flashcard style review session.
 *
 * No DB writes. No FSRS scheduling. Cards are shuffled randomly on load.
 * Two actions: return to the pile or put aside for this session.
 *
 * @param db     - sql.js Database instance (null while loading).
 * @param deckId - Deck UUID to load cards from.
 * @returns Session state and action callbacks.
 */

import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { Database } from 'sql.js';
import type { Card } from '../types';
import { getCardsByDeck } from '../lib/db/queries';
import { hapticFlip, hapticNavigate, hapticCelebration } from '../lib/platform/haptics';
import { v4 as uuidv4 } from 'uuid';
import { choosePractice, createPracticeQueue, navigatePractice, updatePracticeCard } from '../lib/practiceNavigation';
import type { PracticeChoice, PracticeDirection, PracticeQueue } from '../types/practiceNavigation';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ReviewStudyPhase = 'loading' | 'front' | 'back' | 'complete' | 'error';

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
  errorMessage: string;
  retry: () => void;
  currentCard: Card | null;
  seenSessionKey: string;
  seenOccurrenceId: string | null;
  stats: ReviewStudyStats;
  /** Turn between question and answer without advancing or recording a choice. */
  flip: () => void;
  /** Move current card to the end of the queue. */
  sendToBack: () => void;
  /** Remove current card from the queue entirely. */
  putAside: () => void;
  /** Reshuffle put-aside cards for another round. */
  reshufflePutAside: () => void;
  /** Browse adjacent occurrences on their question without a choice or reveal. */
  previous: () => void;
  next: () => void;
  canPrevious: boolean;
  canNext: boolean;
  /** Historical choices stay viewable without repeating or undoing a decision. */
  canChoose: boolean;
  updateCard: (card: Card) => void;
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
  const [queue, setQueue] = useState(() => createPracticeQueue([]));
  const queueRef = useRef(queue);
  const [seenSessionKey, setSeenSessionKey] = useState(() => uuidv4());
  const [phase, setPhase] = useState<ReviewStudyPhase>('loading');
  const phaseRef = useRef(phase);
  const [errorMessage, setErrorMessage] = useState('');
  const [loadVersion, setLoadVersion] = useState(0);
  const changePhase = useCallback((next: ReviewStudyPhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  // ── Load & shuffle cards ────────────────────────────────────────────────
  useLayoutEffect(() => {
    if (!db) return;

    const result = getCardsByDeck(db, deckId);
    if (!result.success) { setErrorMessage('Could not open this deck for practice.'); changePhase('error'); return; }
    setErrorMessage('');
    const next = createPracticeQueue(shuffle(result.data));
    queueRef.current = next;
    setQueue(next);
    setSeenSessionKey(uuidv4());
    changePhase(next.entries.length ? 'front' : 'complete');
  }, [db, deckId, loadVersion, changePhase]);

  // ── Helpers ─────────────────────────────────────────────────────────────

  const advance = useCallback((next: PracticeQueue, celebrate = false) => {
    if (next === queueRef.current) return;
    queueRef.current = next;
    setQueue(next);
    const complete = next.index >= next.entries.length;
    changePhase(complete ? 'complete' : 'front');
    if (celebrate && complete) void hapticCelebration();
  }, [changePhase]);

  // ── Actions ─────────────────────────────────────────────────────────────

  const flip = useCallback(() => {
    if (phaseRef.current !== 'front' && phaseRef.current !== 'back') return;
    hapticFlip();
    changePhase(phaseRef.current === 'front' ? 'back' : 'front');
  }, [changePhase]);

  const choose = useCallback((choice: PracticeChoice) => {
    if (phaseRef.current !== 'back') return;
    advance(choosePractice(queueRef.current, choice, uuidv4()), true);
  }, [advance]);

  const navigate = useCallback((direction: PracticeDirection) => {
    if (phaseRef.current !== 'front' && phaseRef.current !== 'back' && !(phaseRef.current === 'complete' && direction === 'previous')) return;
    const next = navigatePractice(queueRef.current, direction);
    if (next === queueRef.current) return;
    hapticNavigate();
    advance(next);
  }, [advance]);

  const reshufflePutAside = useCallback(() => {
    const cards = queueRef.current.entries.filter(entry => entry.choice === 'aside').map(entry => entry.card);
    if (cards.length === 0) return;
    hapticNavigate();
    const next = createPracticeQueue(shuffle(cards));
    queueRef.current = next;
    setQueue(next);
    setSeenSessionKey(uuidv4());
    changePhase('front');
  }, [changePhase]);

  const updateCard = useCallback((updated: Card) => {
    queueRef.current = updatePracticeCard(queueRef.current, updated);
    setQueue(queueRef.current);
  }, []);

  // ── Return ──────────────────────────────────────────────────────────────

  const current = phase === 'front' || phase === 'back' ? queue.entries[queue.index] : undefined;

  return {
    phase,
    errorMessage,
    retry: () => { changePhase('loading'); setLoadVersion(value => value + 1); },
    currentCard: current?.card ?? null,
    seenSessionKey,
    seenOccurrenceId: current?.occurrenceId ?? null,
    stats: { total:queue.initialCount, remaining:queue.remaining, putAside:queue.putAside },
    flip,
    sendToBack: () => choose('again'),
    putAside: () => choose('aside'),
    reshufflePutAside,
    previous: () => navigate('previous'),
    next: () => navigate('next'),
    canPrevious: queue.entries.length > 0 && queue.index > 0 && phase !== 'loading' && phase !== 'error',
    canNext: Boolean(current),
    canChoose: current?.choice === null,
    updateCard,
  };
}
