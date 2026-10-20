import { describe, expect, it } from 'vitest';
import { countEasterEggTap } from './easterEgg';

describe('painting deck discovery', () => {
  it('requires seven consecutive taps and resets after discovery', () => {
    let state = { count: 0, lastTapAt: 0 };
    for (let tap = 1; tap <= 7; tap++) {
      const result = countEasterEggTap(state, tap * 200);
      expect(result.unlocked).toBe(tap === 7);
      state = result.state;
    }
    expect(countEasterEggTap(state, 1600).unlocked).toBe(false);
  });

  it('does not accumulate taps across a long pause', () => {
    expect(countEasterEggTap({ count: 6, lastTapAt: 1000 }, 3000)).toEqual({
      state: { count: 1, lastTapAt: 3000 }, unlocked: false,
    });
  });
});
