/**
 * Combines FSRS stability/difficulty updates with Anki-style learning steps
 * (minute-based delays from deck `again_steps`, graduating / easy intervals).
 *
 * Pure module: no db, React, or platform imports.
 *
 * @see https://github.com/open-spaced-repetition/fsrs4anki/wiki/The-Algorithm
 */

import type { CardState, LearningState, Rating } from '../../types';
import { initializeCard, reviewCard, type FSRSParams, DEFAULT_PARAMS } from './fsrs';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Deck fields needed for learning-step scheduling. */
export interface DeckLearningSettings {
  /** Minute delays between learning reviews, e.g. [1, 10]. */
  againSteps: number[];
  /** Days after the last learning step before the first review interval. */
  graduatingInterval: number;
  /** Days when pressing Easy on a new (or learning) card. */
  easyInterval: number;
  /** Maximum interval in days (caps how long before a review card comes back). */
  maxInterval?: number;
}

/** Full persisted schedule after one rating (FSRS + learning overlay). */
export interface ResolvedCardSchedule {
  /** Unix seconds when the card is due next. */
  due: number;
  stability: number;
  difficulty: number;
  /** Stored for logs / export; ≥1 for sub-day steps we use a day-bucket minimum. */
  scheduledDays: number;
  state: LearningState;
  reps: number;
  lapses: number;
  learningStepIndex: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalize deck learning steps to positive integer minutes with a safe default.
 *
 * @param raw - Values from deck_settings JSON.
 * @returns Non-empty minute list.
 */
export function normalizeLearningSteps(raw: number[]): number[] {
  const s = raw.map((n) => Math.round(Number(n))).filter((n) => !Number.isNaN(n) && n > 0);
  return s.length > 0 ? s : [1, 10];
}

/**
 * Learning vs relearning label for short-interval phases.
 *
 * @param prev - State before this rating.
 * @returns Next state while still in minute-based steps.
 */
function shortPhaseState(prev: LearningState): LearningState {
  return prev === 'relearning' ? 'relearning' : 'learning';
}

/**
 * Integer day bucket for scheduled_days column when the true delay is in minutes.
 *
 * @param minutes - Step length in minutes.
 * @returns At least 1 so legacy INTEGER column stays valid.
 */
function scheduledDaysBucketForMinutes(minutes: number): number {
  return Math.max(1, Math.ceil(minutes / 1440));
}

/** Builds a ResolvedCardSchedule from FSRS output and scheduling overrides. */
function buildSchedule(
  fsrs: { stability: number; difficulty: number; reps: number; lapses: number },
  due: number,
  scheduledDays: number,
  state: LearningState,
  learningStepIndex: number,
): ResolvedCardSchedule {
  return {
    due,
    stability: fsrs.stability,
    difficulty: fsrs.difficulty,
    scheduledDays,
    state,
    reps: fsrs.reps,
    lapses: fsrs.lapses,
    learningStepIndex,
  };
}

/** Due timestamp for a delay in minutes from now. */
function dueInMinutes(reviewedAt: number, minutes: number): number {
  return reviewedAt + minutes * 60;
}

/** Due timestamp for a delay in days from now. */
function dueInDays(reviewedAt: number, days: number): number {
  return reviewedAt + days * 86400;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute the next card schedule after a rating, applying deck learning steps
 * where appropriate and FSRS everywhere else.
 *
 * @param state       - Card state before the rating.
 * @param rating      - Button chosen by the user.
 * @param reviewedAt  - Current Unix time in seconds.
 * @param elapsedDays - Whole days since last review (0 for first rating).
 * @param deck        - Per-deck learning settings.
 * @param params      - Optional FSRS parameters.
 * @returns Values to persist to `card_states` and show in the UI.
 */
export function resolveSchedule(
  state: CardState,
  rating: Rating,
  reviewedAt: number,
  elapsedDays: number,
  deck: DeckLearningSettings,
  params: FSRSParams = DEFAULT_PARAMS,
): ResolvedCardSchedule {
  const steps = normalizeLearningSteps(deck.againSteps);
  const gradDays = Math.max(1, Math.round(deck.graduatingInterval));
  const easyDays = Math.max(1, Math.round(deck.easyInterval));
  const maxIvl = deck.maxInterval ?? 36500;
  const isNew = state.reps === 0;
  const inShort = state.state === 'learning' || state.state === 'relearning';

  if (isNew) {
    const fsrs = initializeCard(rating, params);
    if (rating === 'easy') {
      return buildSchedule(fsrs, dueInDays(reviewedAt, easyDays), easyDays, 'review', 0);
    }
    if (rating === 'good' && steps.length >= 2) {
      // Good on first view jumps to step 1 (matching Anki: skips step 0 delay).
      const delayMin = steps[1]!;
      return buildSchedule(fsrs, dueInMinutes(reviewedAt, delayMin), scheduledDaysBucketForMinutes(delayMin), 'learning', 1);
    }
    // Hard: stay at step 0, delay = average of steps[0] and steps[1] (or just steps[0]).
    if (rating === 'hard') {
      const delayMin = steps.length >= 2
        ? Math.round((steps[0]! + steps[1]!) / 2)
        : steps[0]!;
      return buildSchedule(fsrs, dueInMinutes(reviewedAt, delayMin), scheduledDaysBucketForMinutes(delayMin), 'learning', 0);
    }
    // Again (or single-step Good): use step 0.
    const delayMin = steps[0]!;
    const stepIndex = rating === 'good' ? 1 : 0;
    return buildSchedule(fsrs, dueInMinutes(reviewedAt, delayMin), scheduledDaysBucketForMinutes(delayMin), 'learning', stepIndex);
  }

  if (inShort) {
    if (rating === 'easy') {
      const out = reviewCard(state, 'easy', elapsedDays, params);
      return buildSchedule(out, dueInDays(reviewedAt, easyDays), easyDays, 'review', 0);
    }
    if (rating === 'again') {
      const out = reviewCard(state, 'again', elapsedDays, params);
      const delayMin = steps[0]!;
      return buildSchedule(out, dueInMinutes(reviewedAt, delayMin), scheduledDaysBucketForMinutes(delayMin), shortPhaseState(state.state), 0);
    }
    if (rating === 'hard') {
      const out = reviewCard(state, 'hard', elapsedDays, params);
      const idx = state.learningStepIndex;
      const delayMin = idx + 1 < steps.length
        ? Math.round((steps[idx]! + steps[idx + 1]!) / 2)
        : steps[idx] != null ? Math.round(steps[idx]! * 1.5) : steps[0]!;
      return buildSchedule(out, dueInMinutes(reviewedAt, delayMin), scheduledDaysBucketForMinutes(delayMin), shortPhaseState(state.state), idx);
    }
    // Good: advance to next step's delay, or graduate if no steps remain.
    const out = reviewCard(state, 'good', elapsedDays, params);
    const nextIdx = state.learningStepIndex + 1;
    if (nextIdx < steps.length) {
      const delayMin = steps[nextIdx]!;
      return buildSchedule(out, dueInMinutes(reviewedAt, delayMin), scheduledDaysBucketForMinutes(delayMin), shortPhaseState(state.state), nextIdx);
    }
    return buildSchedule(out, dueInDays(reviewedAt, gradDays), gradDays, 'review', 0);
  }

  // Review card
  if (rating === 'again') {
    const out = reviewCard(state, 'again', elapsedDays, params);
    const delayMin = steps[0]!;
    return buildSchedule(out, dueInMinutes(reviewedAt, delayMin), scheduledDaysBucketForMinutes(delayMin), 'relearning', 0);
  }

  const fsrs = reviewCard(state, rating, elapsedDays, params);
  const cappedDays = Math.min(fsrs.scheduledDays, maxIvl);
  return buildSchedule(fsrs, dueInDays(reviewedAt, cappedDays), cappedDays, 'review', 0);
}

/**
 * Whether the card should be re-queued at the end of the current session so
 * the user can see it again before leaving (minute steps are often still due
 * later in the same sitting).
 *
 * @param resolved - Output of {@link resolveSchedule}.
 * @returns True when still in learning/relearning after this rating.
 */
export function shouldRequeueAfterRating(resolved: ResolvedCardSchedule): boolean {
  return resolved.state === 'learning' || resolved.state === 'relearning';
}

/**
 * Fractional days until due (for button interval labels).
 *
 * @param resolved - Schedule from {@link resolveSchedule}.
 * @param reviewedAt - Same timestamp used when resolving.
 * @returns Days (can be &lt; 1 for sub-day learning delays).
 */
export function intervalDaysUntilDue(resolved: ResolvedCardSchedule, reviewedAt: number): number {
  return (resolved.due - reviewedAt) / 86400;
}
