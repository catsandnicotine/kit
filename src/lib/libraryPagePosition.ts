import type { LibrarySwipeMode } from '../types/librarySwipe';
import { getLibrarySwipeDistance } from './librarySwipe';

/** Map an in-progress horizontal swipe to the two library dots without changing modes.
 * @param mode - Current controlled library page.
 * @param dx - Net horizontal finger movement in CSS pixels; left is negative.
 * @param width - Width of the swipeable library; its commit gate is the visual midpoint.
 * @returns Clamped progress from Study (0) to Practice (1); this never commits navigation.
 */
export function getLibraryPageProgress(mode: LibrarySwipeMode, dx: number, width: number): number {
  const origin = mode === 'learn' ? 0 : 1;
  if (!Number.isFinite(dx) || !Number.isFinite(width) || width <= 0) return origin;
  const travelDistance = getLibrarySwipeDistance(width) * 2;
  return Math.max(0, Math.min(1, origin - dx / travelDistance));
}
