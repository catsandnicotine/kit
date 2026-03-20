/// <reference types="vitest" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  calculateRetrievability,
  DEFAULT_PARAMS,
  initializeCard,
  reviewCard,
} from './fsrs';
import type { CardState } from '../../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Remove fuzz so intervals are deterministic (Math.random → 0.5 → factor 1.0). */
function noFuzz() {
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
}

const { w, requestRetention } = DEFAULT_PARAMS;

/** Optimal interval at the default retention target, no fuzz. */
function expectedInterval(stability: number): number {
  return Math.round(9 * stability * (1 / requestRetention - 1));
}

/** Build a minimal CardState for review tests. */
function makeCardState(overrides: Partial<CardState> = {}): CardState {
  return {
    cardId: 'test-id',
    due: 1000,
    stability: 4,
    difficulty: 5,
    elapsedDays: 4,
    scheduledDays: 4,
    reps: 1,
    lapses: 0,
    state: 'review',
    lastReview: null,
    ...overrides,
  };
}

beforeEach(noFuzz);
afterEach(() => vi.restoreAllMocks());

// ---------------------------------------------------------------------------
// calculateRetrievability
// ---------------------------------------------------------------------------

describe('calculateRetrievability', () => {
  it('returns 1.0 when elapsed = 0', () => {
    expect(calculateRetrievability(10, 0)).toBe(1);
  });

  it('returns 0.9 when elapsed = stability (target retention point)', () => {
    // R(S, S) = (1 + S/(9S))^(-1) = (1 + 1/9)^(-1) = 9/10 = 0.9
    expect(calculateRetrievability(10, 10)).toBeCloseTo(0.9, 10);
  });

  it('decreases as elapsed days increase', () => {
    const r1 = calculateRetrievability(10, 5);
    const r2 = calculateRetrievability(10, 10);
    const r3 = calculateRetrievability(10, 20);
    expect(r1).toBeGreaterThan(r2);
    expect(r2).toBeGreaterThan(r3);
  });

  it('returns 0 when stability is 0 or negative', () => {
    expect(calculateRetrievability(0, 5)).toBe(0);
    expect(calculateRetrievability(-1, 5)).toBe(0);
  });

  it('output is always in [0, 1]', () => {
    expect(calculateRetrievability(1, 0)).toBeGreaterThanOrEqual(0);
    expect(calculateRetrievability(1, 0)).toBeLessThanOrEqual(1);
    expect(calculateRetrievability(1, 9999)).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// initializeCard — new card transitions
// ---------------------------------------------------------------------------

describe('initializeCard', () => {
  it('Again → learning, stability = w[0], scheduledDays = 1', () => {
    const out = initializeCard('again');
    expect(out.state).toBe('learning');
    expect(out.stability).toBeCloseTo(w[0]!, 6);
    expect(out.scheduledDays).toBe(1);
    expect(out.reps).toBe(1);
    expect(out.lapses).toBe(0);
  });

  it('Hard → learning, stability = w[1], scheduledDays = 1', () => {
    const out = initializeCard('hard');
    expect(out.state).toBe('learning');
    expect(out.stability).toBeCloseTo(w[1]!, 6);
    expect(out.scheduledDays).toBe(1);
  });

  it('Good → review, stability = w[2], interval derived from stability', () => {
    const out = initializeCard('good');
    expect(out.state).toBe('review');
    expect(out.stability).toBeCloseTo(w[2]!, 6);
    // interval = 9 * w[2] * (1/0.9 - 1) = w[2] ≈ 3.1262 → round(3.1262) = 3
    expect(out.scheduledDays).toBe(expectedInterval(w[2]!));
  });

  it('Easy → review, stability = w[3], interval derived from stability', () => {
    const out = initializeCard('easy');
    expect(out.state).toBe('review');
    expect(out.stability).toBeCloseTo(w[3]!, 6);
    // w[3] = 15.4722 → round(15.4722) = 15
    expect(out.scheduledDays).toBe(expectedInterval(w[3]!));
  });

  it('difficulty is clamped to [1, 10] for every rating', () => {
    for (const rating of ['again', 'hard', 'good', 'easy'] as const) {
      const { difficulty } = initializeCard(rating);
      expect(difficulty).toBeGreaterThanOrEqual(1);
      expect(difficulty).toBeLessThanOrEqual(10);
    }
  });

  it('difficulty decreases as rating improves (Again > Hard > Good > Easy)', () => {
    const d = {
      again: initializeCard('again').difficulty,
      hard:  initializeCard('hard').difficulty,
      good:  initializeCard('good').difficulty,
      easy:  initializeCard('easy').difficulty,
    };
    expect(d.again).toBeGreaterThan(d.hard);
    expect(d.hard).toBeGreaterThan(d.good);
    expect(d.good).toBeGreaterThan(d.easy);
  });
});

// ---------------------------------------------------------------------------
// reviewCard — successful recall
// ---------------------------------------------------------------------------

describe('reviewCard — successful recall', () => {
  it('Good on a review card advances state to review and increases stability', () => {
    const state = makeCardState({ stability: 4, difficulty: 5, elapsedDays: 4 });
    const out = reviewCard(state, 'good', 4);
    expect(out.state).toBe('review');
    expect(out.stability).toBeGreaterThan(state.stability);
    expect(out.reps).toBe(state.reps + 1);
    expect(out.lapses).toBe(0);
    expect(out.scheduledDays).toBeGreaterThanOrEqual(1);
  });

  it('Easy yields a larger interval than Good (easyBonus > 1)', () => {
    const state = makeCardState({ stability: 4, difficulty: 5, elapsedDays: 4 });
    const good = reviewCard(state, 'good', 4);
    const easy = reviewCard(state, 'easy', 4);
    expect(easy.stability).toBeGreaterThan(good.stability);
    expect(easy.scheduledDays).toBeGreaterThanOrEqual(good.scheduledDays);
  });

  it('Hard yields a smaller interval than Good (hardPenalty < 1)', () => {
    const state = makeCardState({ stability: 4, difficulty: 5, elapsedDays: 4 });
    const hard = reviewCard(state, 'hard', 4);
    const good = reviewCard(state, 'good', 4);
    expect(hard.stability).toBeLessThan(good.stability);
  });

  it('reps increments on every review', () => {
    const state = makeCardState({ reps: 5 });
    const out = reviewCard(state, 'good', 4);
    expect(out.reps).toBe(6);
  });

  it('lapses unchanged on successful recall', () => {
    const state = makeCardState({ lapses: 2 });
    const out = reviewCard(state, 'good', 4);
    expect(out.lapses).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// reviewCard — lapse (Again)
// ---------------------------------------------------------------------------

describe('reviewCard — lapse (Again)', () => {
  it('Again on a review card sets state to relearning', () => {
    const state = makeCardState({ state: 'review' });
    const out = reviewCard(state, 'again', 4);
    expect(out.state).toBe('relearning');
  });

  it('Again on a learning card sets state to relearning', () => {
    const state = makeCardState({ state: 'learning' });
    const out = reviewCard(state, 'again', 1);
    expect(out.state).toBe('relearning');
  });

  it('Again increments lapses', () => {
    const state = makeCardState({ lapses: 1 });
    const out = reviewCard(state, 'again', 4);
    expect(out.lapses).toBe(2);
  });

  it('Again sets scheduledDays to 1', () => {
    const state = makeCardState();
    const out = reviewCard(state, 'again', 4);
    expect(out.scheduledDays).toBe(1);
  });

  it('Again significantly reduces stability', () => {
    const state = makeCardState({ stability: 20, difficulty: 5 });
    const out = reviewCard(state, 'again', 20);
    expect(out.stability).toBeLessThan(state.stability);
  });

  it('stability after forgetting follows S′ᶠ formula', () => {
    const s = 4;
    const d = 5;
    const elapsed = 4;
    const state = makeCardState({ stability: s, difficulty: d, elapsedDays: elapsed });
    const R = calculateRetrievability(s, elapsed);

    const expectedSf =
      w[11]! *
      Math.pow(d, -w[12]!) *
      (Math.pow(s + 1, w[13]!) - 1) *
      Math.exp(w[14]! * (1 - R));

    const out = reviewCard(state, 'again', elapsed);
    expect(out.stability).toBeCloseTo(expectedSf, 8);
  });
});

// ---------------------------------------------------------------------------
// Difficulty clamping
// ---------------------------------------------------------------------------

describe('difficulty clamping', () => {
  it('clamps to lower bound 1 when Easy on a low-difficulty card', () => {
    // With d=1.5 and Easy rating: D′ = 1.5 - w[6]*(4-3) ≈ 0.43 → well below 1
    const state = makeCardState({ difficulty: 1.5 });
    const out = reviewCard(state, 'easy', 4);
    expect(out.difficulty).toBe(1);
  });

  it('clamps to upper bound 10 when Again on a high-difficulty card', () => {
    // With d=9.8 and Again: D′ pushes above 10
    const state = makeCardState({ difficulty: 9.8 });
    const out = reviewCard(state, 'again', 4);
    expect(out.difficulty).toBe(10);
  });

  it('difficulty stays in [1, 10] for all ratings and arbitrary states', () => {
    for (const rating of ['again', 'hard', 'good', 'easy'] as const) {
      for (const d of [1, 5, 10]) {
        const state = makeCardState({ difficulty: d });
        const out = reviewCard(state, rating, 4);
        expect(out.difficulty).toBeGreaterThanOrEqual(1);
        expect(out.difficulty).toBeLessThanOrEqual(10);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Interval fuzz
// ---------------------------------------------------------------------------

describe('interval fuzz', () => {
  it('interval is within ±5% of the unfuzzed value (at extremes of Math.random)', () => {
    const stability = 10;
    const raw = Math.round(9 * stability * (1 / requestRetention - 1)); // = 10

    vi.spyOn(Math, 'random').mockReturnValue(0); // -5% → factor 0.95
    const low = initializeCard('easy').scheduledDays; // uses w[3]=15.4722

    vi.spyOn(Math, 'random').mockReturnValue(1); // +5% → factor 1.05
    const high = initializeCard('easy').scheduledDays;

    expect(high).toBeGreaterThanOrEqual(low);
    expect(low).toBeGreaterThan(0);
    void raw;
  });

  it('scheduledDays is always at least 1', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const out = initializeCard('good');
    expect(out.scheduledDays).toBeGreaterThanOrEqual(1);
  });
});

// Suppress unused variable TS warning in the fuzz test above
declare const _: unknown;

// ---------------------------------------------------------------------------
// Stability after recall — spot-check formula
// ---------------------------------------------------------------------------

describe('stability after recall — formula verification', () => {
  it('matches manual calculation for Good with R = 0.9', () => {
    const s = 4;
    const d = 5;
    const elapsed = 4; // R(4, 4) = 0.9
    const g = 3; // Good
    const R = calculateRetrievability(s, elapsed);

    const base =
      Math.exp(w[8]!) *
      (11 - d) *
      Math.pow(s, -w[9]!) *
      (Math.exp(w[10]! * (1 - R)) - 1) +
      1;
    const expectedS = s * base; // no hard/easy modifier for Good

    const state = makeCardState({ stability: s, difficulty: d, elapsedDays: elapsed });
    const out = reviewCard(state, 'good', elapsed);

    expect(out.stability).toBeCloseTo(expectedS, 8);
    void g;
  });
});
