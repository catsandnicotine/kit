import { useCallback, useEffect, useRef, useState } from 'react';
import type { Rating } from '../types';
import { hapticRating, hapticReviewChoice } from '../lib/platform/haptics';
import { CHOICE_FEEDBACK_MS } from '../lib/choiceFeedback';

/**
 * Give a choice one short visual beat, rejecting extra taps until it commits.
 * @param onChoose - Existing session action, called once after feedback.
 * @returns Selected choice, a guarded trigger, and a pending flag.
 */
export function useChoiceFeedback<T extends Rating | 'aside'>(onChoose: (choice: T) => void) {
  const [selected, setSelected] = useState<T | null>(null);
  const pending = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const action = useRef(onChoose);
  action.current = onChoose;
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const choose = useCallback((choice: T) => {
    if (pending.current) return;
    pending.current = true;
    setSelected(choice);
    if (choice === 'aside') void hapticReviewChoice(choice);
    else void hapticRating(choice);
    const commit = action.current;
    const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : CHOICE_FEEDBACK_MS;
    timer.current = setTimeout(() => {
      try { commit(choice); }
      finally { pending.current = false; setSelected(null); timer.current = null; }
    }, duration);
  }, []);
  return { selected, choose, pending: selected !== null };
}
