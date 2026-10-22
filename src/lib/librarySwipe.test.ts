import { describe, expect, it } from 'vitest';
import type { LibrarySwipeInput } from '../types/librarySwipe';
import { getLibrarySwipeOffset, getLibrarySwipeTarget } from './librarySwipe';

const deliberateSwipe: LibrarySwipeInput = {
  mode: 'learn', dx: -90, dy: 8, durationMs: 220, width: 400,
};

describe('library swipe intent', () => {
  it('commits a deliberate left swipe from scheduled study to free practice', () => {
    expect(getLibrarySwipeTarget(deliberateSwipe)).toBe('review');
  });

  it('commits the reverse direction from free practice to scheduled study', () => {
    expect(getLibrarySwipeTarget({ ...deliberateSwipe, mode: 'review', dx: 90 })).toBe('learn');
  });

  it('does not wrap past either outer page', () => {
    expect(getLibrarySwipeTarget({ ...deliberateSwipe, dx: 90 })).toBeNull();
    expect(getLibrarySwipeTarget({ ...deliberateSwipe, mode: 'review' })).toBeNull();
  });

  it('cancels a tiny fast flick even when it has ample velocity', () => {
    for (const width of [320, 440, 2000]) {
      expect(getLibrarySwipeTarget({ ...deliberateSwipe, dx: -25, durationMs: 30, width })).toBeNull();
    }
  });

  it('accepts the same deliberate distance at a slow or fast pace', () => {
    expect(getLibrarySwipeTarget({ ...deliberateSwipe, dx: -32, durationMs: 200 })).toBe('review');
    expect(getLibrarySwipeTarget({ ...deliberateSwipe, dx: -32, durationMs: 1000 })).toBe('review');
    expect(getLibrarySwipeTarget({ ...deliberateSwipe, dx: -240, durationMs: 3000 })).toBe('review');
    expect(getLibrarySwipeTarget({ ...deliberateSwipe, dx: -31.9, durationMs: 3000 })).toBeNull();
  });

  it('does not impose a hidden release deadline after the threshold is reached', () => {
    expect(getLibrarySwipeTarget({ ...deliberateSwipe, dx: -160, durationMs: 420 })).toBe('review');
    expect(getLibrarySwipeTarget({ ...deliberateSwipe, dx: -160, durationMs: 421 })).toBe('review');
  });

  it('requires clearly horizontal movement and tolerates a small vertical drift', () => {
    expect(getLibrarySwipeTarget({ ...deliberateSwipe, dy: 64 })).toBe('review');
    expect(getLibrarySwipeTarget({ ...deliberateSwipe, dy: -65 })).toBeNull();
    expect(getLibrarySwipeTarget({ ...deliberateSwipe, dy: 160 })).toBeNull();
  });

  it('honours an established horizontal lock when the finger later drifts vertically', () => {
    const drift = { ...deliberateSwipe, dx: -90, dy: 100, durationMs: 1800 };
    expect(getLibrarySwipeTarget(drift)).toBeNull();
    expect(getLibrarySwipeTarget({ ...drift, horizontalLocked: true })).toBe('review');
    expect(getLibrarySwipeTarget({ ...drift, horizontalLocked: true, dx: -31.9 })).toBeNull();
    expect(getLibrarySwipeTarget({ ...drift, horizontalLocked: true, dx: 90 })).toBeNull();
  });

  it('scales the distance threshold with the library width', () => {
    expect(getLibrarySwipeTarget({ ...deliberateSwipe, dx: -32, durationMs: 180 })).toBe('review');
    expect(getLibrarySwipeTarget({ ...deliberateSwipe, dx: -31.9, durationMs: 180 })).toBeNull();
    expect(getLibrarySwipeTarget({ ...deliberateSwipe, dx: -55.9, width: 800 })).toBeNull();
  });

  it('keeps a minimum distance on small screens and caps it on large screens', () => {
    expect(getLibrarySwipeTarget({ ...deliberateSwipe, dx: -31.9, durationMs: 150, width: 320 })).toBeNull();
    expect(getLibrarySwipeTarget({ ...deliberateSwipe, dx: -32, durationMs: 150, width: 320 })).toBe('review');
    expect(getLibrarySwipeTarget({ ...deliberateSwipe, dx: -55.9, width: 2000 })).toBeNull();
    expect(getLibrarySwipeTarget({ ...deliberateSwipe, dx: -56, width: 2000 })).toBe('review');
  });

  it('accepts a shorter natural thumb swipe at either pace while rejecting diagonal scrolling', () => {
    for (const durationMs of [90, 2000]) {
      expect(getLibrarySwipeTarget({ mode:'review', dx:35.2, dy:20, durationMs, width:440 })).toBe('learn');
      expect(getLibrarySwipeTarget({ mode:'learn', dx:-35.2, dy:-20, durationMs, width:440 })).toBe('review');
      expect(getLibrarySwipeTarget({ mode:'review', dx:35.19, dy:20, durationMs, width:440 })).toBeNull();
      expect(getLibrarySwipeTarget({ mode:'review', dx:35.2, dy:30, durationMs, width:440 })).toBeNull();
    }
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('rejects an invalid duration of %s', durationMs => {
    expect(getLibrarySwipeTarget({ ...deliberateSwipe, durationMs })).toBeNull();
  });

  it.each([
    { dx: Number.NaN },
    { dx: Number.NEGATIVE_INFINITY },
    { dy: Number.NaN },
    { dy: Number.POSITIVE_INFINITY },
    { width: 0 },
    { width: -400 },
    { width: Number.NaN },
    { width: Number.POSITIVE_INFINITY },
  ])('rejects invalid gesture geometry %j', invalid => {
    expect(getLibrarySwipeTarget({ ...deliberateSwipe, ...invalid })).toBeNull();
  });
});

describe('bounded library drag presentation', () => {
  it('resists both outside edges without exposing a large empty area', () => {
    const rightEdge = getLibrarySwipeOffset('learn', 1000, 400);
    const leftEdge = getLibrarySwipeOffset('review', -1000, 400);
    expect(rightEdge).toBeGreaterThan(0);
    expect(rightEdge).toBeLessThanOrEqual(12);
    expect(leftEdge).toBe(-rightEdge);
  });

  it('caps even an oversized inward drag and keeps both directions symmetric', () => {
    const inward = getLibrarySwipeOffset('learn', -1000, 400);
    expect(inward).toBeGreaterThanOrEqual(-48);
    expect(inward).toBeLessThan(0);
    expect(getLibrarySwipeOffset('review', 1000, 400)).toBe(-inward);
  });

  it('tracks the finger continuously while progressively resisting more travel', () => {
    const first = Math.abs(getLibrarySwipeOffset('learn', -30, 400));
    const second = Math.abs(getLibrarySwipeOffset('learn', -60, 400));
    const third = Math.abs(getLibrarySwipeOffset('learn', -90, 400));
    expect(first).toBeGreaterThan(0);
    expect(second).toBeGreaterThan(first);
    expect(third).toBeGreaterThan(second);
    expect(third - second).toBeLessThan(second - first);
    expect(getLibrarySwipeOffset('learn', 0, 400)).toBe(0);
  });

  it('returns cleanly to the origin when crossing the start and rejects invalid geometry', () => {
    expect(getLibrarySwipeOffset('learn', -0.01, 400)).toBeCloseTo(-0.006, 4);
    expect(getLibrarySwipeOffset('learn', 0.01, 400)).toBeCloseTo(0.0012, 4);
    expect(getLibrarySwipeOffset('learn', Number.NaN, 400)).toBe(0);
    expect(getLibrarySwipeOffset('learn', 100, 0)).toBe(0);
    expect(getLibrarySwipeOffset('review', 100, Number.POSITIVE_INFINITY)).toBe(0);
  });
});
