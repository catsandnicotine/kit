import type { LibrarySwipeInput, LibrarySwipeMode } from '../types/librarySwipe';

/** Shared settling time for the library content and its travelling page pixel. */
export const LIBRARY_SWIPE_SETTLE_MS = 120;
/** A thumb's diagonal travel can still express clear horizontal intent. */
export const LIBRARY_SWIPE_HORIZONTAL_RATIO = 1.4;

/** Get the deliberate drag distance shared by navigation and its page marker.
 * @param width - Captured width of the swipeable library in CSS pixels.
 * @returns The bounded distance gate, or zero for an invalid width.
 */
export function getLibrarySwipeDistance(width: number): number {
  return Number.isFinite(width) && width > 0 ? Math.max(32, Math.min(width * 0.08, 56)) : 0;
}

/**
 * Resolve a deliberate horizontal library swipe without changing any state.
 *
 * Require at least 8% of the library width (bounded to 32–56 CSS pixels).
 * Horizontal movement must be at least 1.4 times vertical movement unless the
 * controller already locked that axis. Later drift cannot revoke the visible
 * horizontal gesture. A deliberate drag qualifies at any pace.
 *
 * @param input - Current page, net gesture movement, elapsed time and area width.
 * @returns The adjacent page in the swipe direction, or null to stay put.
 */
export function getLibrarySwipeTarget(input: LibrarySwipeInput): LibrarySwipeMode | null {
  const { mode, dx, dy, durationMs, width, horizontalLocked = false } = input;
  if (![dx, dy, durationMs, width].every(Number.isFinite) || durationMs <= 0 || width <= 0) return null;

  const distance = Math.abs(dx);
  const minimumDistance = getLibrarySwipeDistance(width);
  if (
    distance < minimumDistance ||
    (!horizontalLocked && distance < Math.abs(dy) * LIBRARY_SWIPE_HORIZONTAL_RATIO)
  ) return null;

  if (mode === 'learn' && dx < 0) return 'review';
  if (mode === 'review' && dx > 0) return 'learn';
  return null;
}

/** Give a library drag a small, bounded displacement instead of an empty page.
 * @param mode - Current controlled page, used to identify its outside edge.
 * @param dx - Net horizontal finger movement in CSS pixels.
 * @param width - Captured swipeable-library width in CSS pixels.
 * @returns A resisted displacement, bounded to 48px inward and 12px outward.
 */
export function getLibrarySwipeOffset(mode: LibrarySwipeMode, dx: number, width: number): number {
  if (!Number.isFinite(dx) || !Number.isFinite(width) || width <= 0) return 0;
  const outsideEdge = mode === 'learn' ? dx > 0 : dx < 0;
  const limit = outsideEdge ? Math.min(12, width * 0.03) : Math.min(48, width * 0.12);
  const resistance = outsideEdge ? 0.12 : 0.6;
  return Math.sign(dx) * limit * (1 - Math.exp(-Math.abs(dx) * resistance / limit));
}
