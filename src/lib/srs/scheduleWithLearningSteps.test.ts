/// <reference types="vitest" />
import { describe, expect, it } from 'vitest';
import type { CardState } from '../../types';
import {
  intervalDaysUntilDue,
  normalizeLearningSteps,
  resolveSchedule,
  shouldRequeueAfterRating,
} from './scheduleWithLearningSteps';

const deck = {
  againSteps: [1, 10],
  graduatingInterval: 3,
  easyInterval: 4,
};

function baseNew(cardId = 'c1'): CardState {
  return {
    cardId,
    due: 0,
    stability: 0,
    difficulty: 0,
    elapsedDays: 0,
    scheduledDays: 0,
    reps: 0,
    lapses: 0,
    state: 'new',
    lastReview: null,
    learningStepIndex: 0,
    suspended: false,
  };
}

describe('normalizeLearningSteps', () => {
  it('filters non-positive and defaults to [1,10]', () => {
    expect(normalizeLearningSteps([])).toEqual([1, 10]);
    expect(normalizeLearningSteps([-1, 0])).toEqual([1, 10]);
    expect(normalizeLearningSteps([5, 15])).toEqual([5, 15]);
  });
});

describe('resolveSchedule — new card', () => {
  const now = 1_700_000_000;

  it('Again uses first step in minutes', () => {
    const s = resolveSchedule(baseNew(), 'again', now, 0, deck);
    expect(s.state).toBe('learning');
    expect(s.due).toBe(now + 60);
    expect(s.learningStepIndex).toBe(0);
    expect(intervalDaysUntilDue(s, now)).toBeCloseTo(60 / 86400, 10);
  });

  it('Good on new card jumps to step 1 delay (skips step 0, matching Anki)', () => {
    const s = resolveSchedule(baseNew(), 'good', now, 0, deck);
    expect(s.state).toBe('learning');
    expect(s.due).toBe(now + 10 * 60); // steps[1] = 10m
    expect(s.learningStepIndex).toBe(1);
    expect(shouldRequeueAfterRating(s)).toBe(true);
  });

  it('Hard on new card uses average of steps[0] and steps[1]', () => {
    const s = resolveSchedule(baseNew(), 'hard', now, 0, deck);
    expect(s.state).toBe('learning');
    // average of 1m and 10m = 6m (rounded)
    expect(s.due).toBe(now + 6 * 60);
    expect(s.learningStepIndex).toBe(0);
    expect(shouldRequeueAfterRating(s)).toBe(true);
  });

  it('Hard on new card differs from Again', () => {
    const again = resolveSchedule(baseNew(), 'again', now, 0, deck);
    const hard = resolveSchedule(baseNew(), 'hard', now, 0, deck);
    expect(hard.due).not.toBe(again.due);
    expect(hard.due).toBeGreaterThan(again.due);
  });

  it('Easy skips to review with easy interval days', () => {
    const s = resolveSchedule(baseNew(), 'easy', now, 0, deck);
    expect(s.state).toBe('review');
    expect(s.due).toBe(now + 4 * 86400);
    expect(s.learningStepIndex).toBe(0);
    expect(shouldRequeueAfterRating(s)).toBe(false);
  });
});

describe('resolveSchedule — learning', () => {
  const now = 1_700_000_000;

  it('Good at idx=0 advances to step 1 delay', () => {
    // After pressing Again on a new card (idx=0), Good should show step 1's delay.
    const afterAgain: CardState = {
      ...baseNew(),
      reps: 1,
      state: 'learning',
      learningStepIndex: 0,
      stability: 1,
      difficulty: 5,
      lastReview: now - 60,
    };
    const s = resolveSchedule(afterAgain, 'good', now, 0, deck);
    expect(s.state).toBe('learning');
    expect(s.due).toBe(now + 10 * 60); // steps[1] = 10m
    expect(s.learningStepIndex).toBe(1);
  });

  it('Good at idx=1 graduates the card', () => {
    // After the 10m step (idx=1), Good should graduate.
    const atLastStep: CardState = {
      ...baseNew(),
      reps: 2,
      state: 'learning',
      learningStepIndex: 1,
      stability: 1,
      difficulty: 5,
      lastReview: now - 600,
    };
    const s = resolveSchedule(atLastStep, 'good', now, 0, deck);
    expect(s.state).toBe('review');
    expect(s.due).toBe(now + 3 * 86400); // graduatingInterval = 3d
    expect(s.learningStepIndex).toBe(0);
    expect(shouldRequeueAfterRating(s)).toBe(false);
  });

  it('Hard stays at current step index with averaged delay', () => {
    const atStep0: CardState = {
      ...baseNew(),
      reps: 1,
      state: 'learning',
      learningStepIndex: 0,
      stability: 1,
      difficulty: 5,
      lastReview: now - 60,
    };
    const s = resolveSchedule(atStep0, 'hard', now, 0, deck);
    expect(s.state).toBe('learning');
    expect(s.learningStepIndex).toBe(0); // stays at current step
    // average of steps[0]=1 and steps[1]=10 = 6m
    expect(s.due).toBe(now + 6 * 60);
  });

  it('Hard at last step uses 1.5x current step delay', () => {
    const atStep1: CardState = {
      ...baseNew(),
      reps: 2,
      state: 'learning',
      learningStepIndex: 1,
      stability: 1,
      difficulty: 5,
      lastReview: now - 600,
    };
    const s = resolveSchedule(atStep1, 'hard', now, 0, deck);
    expect(s.state).toBe('learning');
    expect(s.learningStepIndex).toBe(1); // stays at current step
    // steps[1]=10, no next step, so 10*1.5 = 15m
    expect(s.due).toBe(now + 15 * 60);
  });

  it('Again resets learning step index', () => {
    const st: CardState = {
      ...baseNew(),
      reps: 2,
      state: 'learning',
      learningStepIndex: 2,
      stability: 2,
      difficulty: 5,
      lastReview: now - 60,
    };
    const s = resolveSchedule(st, 'again', now, 0, deck);
    expect(s.learningStepIndex).toBe(0);
    expect(s.due).toBe(now + 60);
  });
});

describe('resolveSchedule — review lapse', () => {
  const now = 1_700_000_000;

  it('Again on review enters relearning with first step', () => {
    const st: CardState = {
      ...baseNew(),
      reps: 5,
      state: 'review',
      stability: 10,
      difficulty: 5,
      learningStepIndex: 0,
      lastReview: now - 86400,
    };
    const s = resolveSchedule(st, 'again', now, 1, deck);
    expect(s.state).toBe('relearning');
    expect(s.due).toBe(now + 60);
    expect(shouldRequeueAfterRating(s)).toBe(true);
  });
});
