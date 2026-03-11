/**
 * FSRS v4 spaced-repetition algorithm — pure math module.
 *
 * Rules:
 *  - Zero imports from db, platform, or UI.
 *  - All inputs/outputs are plain values; no side effects.
 *
 * Key formulas:
 *  - Forgetting curve : R(t, S)  = (1 + t / (9 · S))^(−1)
 *  - Optimal interval : I(S, r)  = 9 · S · (1/r − 1)
 *  - Initial stability : S₀(g)   = w[g−1]
 *  - Initial difficulty: D₀(g)   = w[4] − exp(w[5]·(g−1)) + 1  ∈ [1, 10]
 *  - Next difficulty   : D′      = D − w[6]·(g−3)
 *                        D″      = w[7]·D₀(4) + (1−w[7])·D′       ∈ [1, 10]
 *  - Recall stability  : S′ᵣ     = S·(e^w[8]·(11−D)·S^(−w[9])·(e^(w[10]·(1−R))−1)+1)
 *                                    · hardPenalty · easyBonus
 *  - Forget stability  : S′ᶠ     = w[11]·D^(−w[12])·((S+1)^w[13]−1)·e^(w[14]·(1−R))
 *
 * @see https://github.com/open-spaced-repetition/fsrs4anki
 */

import type { CardState, FSRSOutput, LearningState, Rating } from '../../types';

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

/** FSRS v4 default weight vector and scheduling settings. */
export interface FSRSParams {
  /** 19 learned weights w[0]…w[18]. */
  w: readonly number[];
  /** Target retention probability (0–1). Default 0.9. */
  requestRetention: number;
  /** Hard ceiling on any scheduled interval in days. Default 36500. */
  maximumInterval: number;
}

/** Default FSRS v4 parameters (blueprint values). */
export const DEFAULT_PARAMS: FSRSParams = {
  w: [
    0.4072, 1.1829, 3.1262, 15.4722, 7.2102,
    0.5316, 1.0651, 0.0589,  1.5330,  0.1544,
    1.0175, 1.8294, 0.0900,  0.2788,  2.2243,
    0.2898, 2.9898, 0.5190,  0.6850,
  ],
  requestRetention: 0.9,
  maximumInterval: 36500,
} as const;

// ---------------------------------------------------------------------------
// Rating ordinals  (Again=1, Hard=2, Good=3, Easy=4)
// ---------------------------------------------------------------------------

const ORDINAL: Record<Rating, number> = { again: 1, hard: 2, good: 3, easy: 4 };

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Calculate the probability of recall at a given elapsed time.
 *
 * Uses the simplified forgetting curve:
 *   R(t, S) = (1 + t / (9 · S))^(−1)
 *
 * @param stability   - Current stability in days (must be > 0).
 * @param elapsedDays - Days since the last review (≥ 0).
 * @returns Retrievability in [0, 1]. Returns 0 when stability ≤ 0.
 */
export function calculateRetrievability(stability: number, elapsedDays: number): number {
  if (stability <= 0) return 0;
  return 1 / (1 + elapsedDays / (9 * stability));
}

/**
 * Initialize FSRS scheduling for a brand-new (never-reviewed) card.
 *
 * @param rating  - The first rating given to the card.
 * @param params  - FSRS parameters. Defaults to {@link DEFAULT_PARAMS}.
 * @returns Scheduling output with initial stability, difficulty, and interval.
 */
export function initializeCard(
  rating: Rating,
  params: FSRSParams = DEFAULT_PARAMS,
): FSRSOutput {
  const { w, requestRetention, maximumInterval } = params;
  const g = ORDINAL[rating];

  const stability = w[g - 1];
  const difficulty = clampDifficulty(initialDifficulty(g, w));

  // Cards rated Again or Hard enter a short learning cycle (1 day).
  // Cards rated Good or Easy go straight to the review queue.
  let state: LearningState;
  let scheduledDays: number;

  if (rating === 'again' || rating === 'hard') {
    state = 'learning';
    scheduledDays = 1;
  } else {
    state = 'review';
    scheduledDays = fuzzedInterval(optimalInterval(stability, requestRetention), maximumInterval);
  }

  return { stability, difficulty, scheduledDays, state, reps: 1, lapses: 0 };
}

/**
 * Compute new FSRS scheduling after reviewing a card that has been seen before.
 *
 * @param cardState   - Current persisted state of the card.
 * @param rating      - Rating given during this review session.
 * @param elapsedDays - Days elapsed since the last review.
 * @param params      - FSRS parameters. Defaults to {@link DEFAULT_PARAMS}.
 * @returns Updated scheduling output.
 */
export function reviewCard(
  cardState: CardState,
  rating: Rating,
  elapsedDays: number,
  params: FSRSParams = DEFAULT_PARAMS,
): FSRSOutput {
  const { w, requestRetention, maximumInterval } = params;
  const g = ORDINAL[rating];
  const { stability, difficulty, reps, lapses } = cardState;

  const R = calculateRetrievability(stability, elapsedDays);
  const newDifficulty = clampDifficulty(nextDifficulty(difficulty, g, w));

  let newStability: number;
  let newState: LearningState;
  let newLapses: number;
  let scheduledDays: number;

  if (rating === 'again') {
    // Lapse: card was forgotten — use forgetting stability formula.
    newStability = stabilityAfterForgetting(difficulty, stability, R, w);
    newState = cardState.state === 'new' ? 'learning' : 'relearning';
    newLapses = lapses + 1;
    scheduledDays = 1;
  } else {
    // Successful recall — use recall stability formula.
    newStability = stabilityAfterRecall(difficulty, stability, R, g, w);
    newState = 'review';
    newLapses = lapses;
    scheduledDays = fuzzedInterval(optimalInterval(newStability, requestRetention), maximumInterval);
  }

  return {
    stability: newStability,
    difficulty: newDifficulty,
    scheduledDays,
    state: newState,
    reps: reps + 1,
    lapses: newLapses,
  };
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Optimal interval in days for a target retention probability.
 *
 * Derived from R = (1 + t/(9S))^(−1):
 *   I = 9 · S · (1/r − 1)
 *
 * For the default r = 0.9 this simplifies to I = S.
 *
 * @param stability        - Current stability in days.
 * @param requestRetention - Target retention (0–1).
 * @returns Raw interval in fractional days.
 */
function optimalInterval(stability: number, requestRetention: number): number {
  return 9 * stability * (1 / requestRetention - 1);
}

/**
 * Apply ±5% uniform fuzz to an interval, then clamp to [1, maximumInterval].
 *
 * Fuzz prevents cards from always clustering on the same review day.
 *
 * @param interval        - Raw interval in days.
 * @param maximumInterval - Hard ceiling in days.
 * @returns Integer interval in [1, maximumInterval].
 */
function fuzzedInterval(interval: number, maximumInterval: number): number {
  const fuzz = 1 + (Math.random() * 0.1 - 0.05); // uniform ±5 %
  return Math.min(maximumInterval, Math.max(1, Math.round(interval * fuzz)));
}

/**
 * Initial difficulty for a new card with first rating g.
 *
 * D₀(g) = w[4] − exp(w[5] · (g − 1)) + 1
 *
 * @param g - Rating ordinal (1–4).
 * @param w - FSRS weight array.
 * @returns Raw difficulty (not yet clamped).
 */
function initialDifficulty(g: number, w: readonly number[]): number {
  return w[4] - Math.exp(w[5] * (g - 1)) + 1;
}

/**
 * Update difficulty after a review with mean reversion toward D₀(Easy).
 *
 * D′  = D − w[6] · (g − 3)
 * D″  = w[7] · D₀(4) + (1 − w[7]) · D′
 *
 * @param d - Current difficulty.
 * @param g - Rating ordinal (1–4).
 * @param w - FSRS weight array.
 * @returns Raw next difficulty (not yet clamped).
 */
function nextDifficulty(d: number, g: number, w: readonly number[]): number {
  const d0Easy = initialDifficulty(4, w);
  const dPrime = d - w[6] * (g - 3);
  return w[7] * d0Easy + (1 - w[7]) * dPrime;
}

/**
 * Clamp difficulty to the valid range [1, 10].
 *
 * @param d - Raw difficulty value.
 * @returns Clamped difficulty in [1, 10].
 */
function clampDifficulty(d: number): number {
  return Math.min(10, Math.max(1, d));
}

/**
 * New stability after a successful recall.
 *
 * S′ᵣ = S · (e^w[8] · (11−D) · S^(−w[9]) · (e^(w[10]·(1−R)) − 1) + 1)
 *         · hardPenalty · easyBonus
 *
 * Where hardPenalty = w[15] (< 1) and easyBonus = w[16] (> 1).
 *
 * @param d - Difficulty at time of review.
 * @param s - Stability at time of review.
 * @param R - Retrievability at time of review.
 * @param g - Rating ordinal (1–4).
 * @param w - FSRS weight array.
 * @returns New stability in days.
 */
function stabilityAfterRecall(
  d: number,
  s: number,
  R: number,
  g: number,
  w: readonly number[],
): number {
  const hardPenalty = g === ORDINAL.hard ? w[15] : 1;
  const easyBonus   = g === ORDINAL.easy ? w[16] : 1;
  const base =
    Math.exp(w[8]) *
    (11 - d) *
    Math.pow(s, -w[9]) *
    (Math.exp(w[10] * (1 - R)) - 1) +
    1;
  return s * base * hardPenalty * easyBonus;
}

/**
 * New stability after a lapse (rating = Again).
 *
 * S′ᶠ = w[11] · D^(−w[12]) · ((S+1)^w[13] − 1) · e^(w[14]·(1−R))
 *
 * @param d - Difficulty at time of review.
 * @param s - Stability at time of review.
 * @param R - Retrievability at time of review.
 * @param w - FSRS weight array.
 * @returns New (reduced) stability in days.
 */
function stabilityAfterForgetting(
  d: number,
  s: number,
  R: number,
  w: readonly number[],
): number {
  return (
    w[11] *
    Math.pow(d, -w[12]) *
    (Math.pow(s + 1, w[13]) - 1) *
    Math.exp(w[14] * (1 - R))
  );
}
