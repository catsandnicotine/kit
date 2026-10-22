/** Inputs for the browser library search's presentation and dismissal. */
export interface LibrarySearchOptions {
  open: boolean;
  native: boolean;
  onClose: () => void;
}

/** Keep the field mounted while its closing class runs. */
export interface LibrarySearchPresentation {
  mounted: boolean;
  closing: boolean;
}

/** The one outside pointer sequence consumed by search dismissal. */
export interface LibrarySearchDismissalPointer {
  id: number;
  x: number;
  y: number;
}
