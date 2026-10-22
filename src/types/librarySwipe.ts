/** The existing scheduled-study and free-practice library pages. */
export type LibrarySwipeMode = 'learn' | 'review';

/** Net movement from touch-down to release, measured in CSS pixels. */
export interface LibrarySwipeInput {
  mode: LibrarySwipeMode;
  dx: number;
  dy: number;
  /** Elapsed time from touch-down to release, in milliseconds. */
  durationMs: number;
  /** Width of the swipeable library area, in CSS pixels. */
  width: number;
  /** A controller already chose horizontal intent before the later finger drift. */
  horizontalLocked?: boolean;
}
