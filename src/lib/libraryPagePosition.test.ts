import { describe, expect, it } from 'vitest';
import { getLibraryPageProgress } from './libraryPagePosition';
import { getLibrarySwipeTarget } from './librarySwipe';

describe('library page traveller', () => {
  it('tracks both valid swipe directions continuously between the same endpoints', () => {
    expect(getLibraryPageProgress('learn', 0, 400)).toBe(0);
    expect(getLibraryPageProgress('learn', -32, 400)).toBe(0.5);
    expect(getLibraryPageProgress('learn', -64, 400)).toBe(1);
    expect(getLibraryPageProgress('review', 0, 400)).toBe(1);
    expect(getLibraryPageProgress('review', 32, 400)).toBe(0.5);
    expect(getLibraryPageProgress('review', 64, 400)).toBe(0);
  });

  it('does not travel outside either page or overshoot on long drags', () => {
    expect(getLibraryPageProgress('learn', 90, 400)).toBe(0);
    expect(getLibraryPageProgress('review', -90, 400)).toBe(1);
    expect(getLibraryPageProgress('learn', -1000, 400)).toBe(1);
    expect(getLibraryPageProgress('review', 1000, 400)).toBe(0);
  });

  it('places the bounded gesture threshold at the midpoint across screen sizes', () => {
    expect(getLibraryPageProgress('learn', -32, 320)).toBe(0.5);
    expect(getLibraryPageProgress('learn', -56, 2000)).toBe(0.5);
  });

  it('keeps the controlled position for invalid geometry', () => {
    expect(getLibraryPageProgress('learn', Number.NaN, 400)).toBe(0);
    expect(getLibraryPageProgress('review', 40, 0)).toBe(1);
    expect(getLibraryPageProgress('review', 40, Number.POSITIVE_INFINITY)).toBe(1);
  });

  it('crosses the middle when a slow drag qualifies, leaving a visible landing', () => {
    for (const width of [320, 400, 440, 800]) {
      const dx = -Math.max(32, Math.min(width * 0.08, 56));
      expect(getLibraryPageProgress('learn', dx, width)).toBe(0.5);
      expect(getLibraryPageProgress('review', -dx, width)).toBe(0.5);
      expect(getLibraryPageProgress('learn', dx * 2, width)).toBe(1);
      expect(getLibrarySwipeTarget({ mode: 'learn', dx, dy: 4, durationMs: 2000, width })).toBe('review');
      expect(getLibrarySwipeTarget({ mode: 'review', dx: -dx, dy: 4, durationMs: 2000, width })).toBe('learn');
    }
  });
});
