import { describe, expect, it } from 'vitest';
import { cardTurnAxis, cardTurnDragAngle, cardTurnFace, cardTurnFaceAngle, cardTurnReleaseAngle, cardTurnRevealAngle, cardTurnTravel, stepCardTurnSpring } from './cardTurn';
import type { CardTurnSpring } from '../types/cardTurn';

describe('card turn intent', () => {
  it('uses distance in either direction rather than a velocity shortcut', () => {
    expect(cardTurnReleaseAngle(0, 89.99)).toBe(0);
    expect(cardTurnReleaseAngle(0, -89.99)).toBe(0);
    expect(cardTurnReleaseAngle(0, 90)).toBe(180);
    expect(cardTurnReleaseAngle(0, -90)).toBe(-180);
    expect(cardTurnReleaseAngle(180, 90.01)).toBe(180);
    expect(cardTurnReleaseAngle(180, 89.99)).toBe(0);
  });

  it('has the same halfway gesture on compact and large devices', () => {
    for (const width of [246, 320, 440, 768, 1024]) {
      const travel = cardTurnTravel(width);
      expect(travel).toBeLessThanOrEqual(360);
      expect(cardTurnReleaseAngle(0, cardTurnDragAngle(travel * .49, width))).toBe(0);
      expect(cardTurnReleaseAngle(0, cardTurnDragAngle(travel * .51, width))).toBe(180);
      expect(cardTurnReleaseAngle(0, cardTurnDragAngle(-travel * .51, width))).toBe(-180);
    }
  });

  it('resists past one turn and handles an unavailable viewport', () => {
    expect(cardTurnDragAngle(256, 320)).toBe(180);
    expect(cardTurnDragAngle(640, 320)).toBeGreaterThan(180);
    expect(cardTurnDragAngle(640, 320)).toBeLessThanOrEqual(200);
    expect(cardTurnDragAngle(-10000, 320)).toBe(-200);
    expect(cardTurnDragAngle(100, 0)).toBe(0);
    expect(cardTurnDragAngle(Infinity, 320)).toBe(0);
  });

  it('waits out small jitter and gives ambiguous diagonals to native scrolling', () => {
    expect(cardTurnAxis(11, 2)).toBe('pending');
    expect(cardTurnAxis(12, 0)).toBe('horizontal');
    expect(cardTurnAxis(15, 10)).toBe('horizontal');
    expect(cardTurnAxis(12, 10)).toBe('vertical');
    expect(cardTurnAxis(-12, -10)).toBe('vertical');
    expect(cardTurnAxis(3, 12)).toBe('vertical');
  });

  it('latches exposure and returns to the nearest answer after reversing', () => {
    expect(cardTurnRevealAngle('front', 89, false)).toBeNull();
    expect(cardTurnRevealAngle('front', 110, false)).toBe(180);
    expect(cardTurnRevealAngle('back', 20, true)).toBe(180);
    expect(cardTurnRevealAngle('back', -120, true)).toBe(-180);
    expect(Math.abs(cardTurnRevealAngle('back', -120, true)! - -120)).toBe(60);
    expect(cardTurnRevealAngle('back', 20, false)).toBeNull();
  });

  it('returns a re-grabbed early spring to the controlled face when cancelled', () => {
    // The answer was committed but its visual turn has only reached 30 degrees.
    const angle = 30;
    expect(cardTurnFace(angle)).toBe('front');
    const cancelled = cardTurnFaceAngle('back', angle);
    expect(cancelled).toBe(180);
    expect(cardTurnFace(cancelled)).toBe('back');

    // Releasing near the visible question instead commits exactly one back→front change.
    const release = cardTurnReleaseAngle(Math.round(angle / 180) * 180, 40);
    expect(release).toBe(0);
    expect(cardTurnFace(release)).toBe('front');
  });

  it('finds a nearby flat angle with the requested face after repeated turns', () => {
    for (const angle of [-900, -410, -180, -10, 0, 30, 179, 400, 910]) {
      for (const face of ['front', 'back'] as const) {
        const flat = cardTurnFaceAngle(face, angle);
        expect(cardTurnFace(flat)).toBe(face);
        expect(Math.abs(flat - angle)).toBeLessThanOrEqual(180);
      }
    }
  });
});

describe('card turn settling', () => {
  function simulate(hz: number, initial: CardTurnSpring) {
    let state = initial;
    let elapsed = 0;
    while (elapsed < 1) {
      const next = stepCardTurnSpring(state, 1 / hz);
      elapsed += 1 / hz;
      state = next;
      if (next.done) return { state, elapsed };
    }
    throw new Error('Card turn did not settle');
  }

  it('settles the same face at 60/120Hz without an elastic idle tail', () => {
    const sixty = simulate(60, { angle:0, target:180, velocity:0 });
    const oneTwenty = simulate(120, { angle:0, target:180, velocity:0 });
    expect(sixty.state).toMatchObject({ angle:180, velocity:0 });
    expect(oneTwenty.state).toMatchObject({ angle:180, velocity:0 });
    expect(sixty.elapsed).toBeLessThan(.48);
    expect(Math.abs(sixty.elapsed - oneTwenty.elapsed)).toBeLessThan(.04);
  });

  it('cancels a short drag and settles either flipped direction', () => {
    for (const initial of [
      { angle:20, target:0, velocity:0 },
      { angle:-110, target:-180, velocity:-620 },
      { angle:110, target:180, velocity:620 },
      { angle:30, target:180, velocity:0 },
    ]) {
      const { state, elapsed } = simulate(120, initial);
      expect(state.angle).toBe(initial.target);
      expect(state.velocity).toBe(0);
      expect(elapsed).toBeLessThan(.48);
    }
  });

  it('bounds a delayed frame so returning from a busy frame cannot launch the card', () => {
    const delayed = stepCardTurnSpring({ angle:70, target:180, velocity:620 }, 3);
    const bounded = stepCardTurnSpring({ angle:70, target:180, velocity:620 }, .032);
    expect(delayed).toEqual(bounded);
    expect(delayed.angle).toBeGreaterThan(70);
    expect(delayed.angle).toBeLessThan(180);
  });
});
