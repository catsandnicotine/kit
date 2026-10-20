import type { EasterEggTapState } from '../types/jesusPaintings';

/** Count consecutive version taps, resetting after a pause.
 * @param previous - State from the previous tap.
 * @param now - Current monotonic time in milliseconds.
 * @returns Updated tap state and whether seven taps unlocked the deck.
 */
export function countEasterEggTap(previous: EasterEggTapState, now: number) {
  const count = now - previous.lastTapAt > 1800 || now < previous.lastTapAt ? 1 : previous.count + 1;
  return { state: { count: count >= 7 ? 0 : count, lastTapAt: now }, unlocked: count >= 7 };
}
