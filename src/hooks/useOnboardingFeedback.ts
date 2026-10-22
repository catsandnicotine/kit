import { useState } from 'react';
import type { Rating } from '../types';
import { hapticFlip, hapticNavigate } from '../lib/platform/haptics';
import { useChoiceFeedback } from './useChoiceFeedback';

/**
 * Keep the first-run demonstration local, with the same feedback as a real card.
 * @param existingDeckCount - Existing libraries can go directly to their decks.
 * @returns Demo stage, creation route, and quiet interaction callbacks; no study writes.
 */
export function useOnboardingFeedback(existingDeckCount: number) {
  const [step, setStep] = useState<'question' | 'answer' | 'setup'>('question');
  const [creating, setCreating] = useState(false);
  const feedback = useChoiceFeedback<Rating>(() => setStep('setup'));
  return {
    step: existingDeckCount > 0 ? 'setup' as const : step,
    creating,
    selected: feedback.selected,
    pending: feedback.pending,
    choose: feedback.choose,
    reveal: () => {
      if (step !== 'question') return;
      void hapticFlip();
      setStep('answer');
    },
    skipDemo: () => {
      void hapticNavigate();
      setStep('setup');
    },
    startCreation: () => {
      void hapticNavigate();
      setCreating(true);
    },
    closeCreation: () => {
      void hapticNavigate();
      setCreating(false);
    },
  };
}
