/** A gesture-scoped, optional selection detent cancelled by other feedback. */
export interface LibrarySwipeHapticFeedback {
  /** A valid inward drag has lifted away from its resting page. */
  lift: () => Promise<void>;
  /** The drag first crossed the navigation distance. */
  threshold: () => Promise<void>;
  /** The committed page finished settling; also closes this feedback scope. */
  land: () => Promise<void>;
  /** Retire pending feedback without adding a pulse or affecting newer actions. */
  cancel: () => void;
}
