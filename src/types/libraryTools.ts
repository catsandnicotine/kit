/** Direct library utilities in the bottom row. */
export interface LibraryDockProps {
  onSearch: () => void;
  onSettings: () => void;
  onAdd: () => void;
  searchOpen: boolean;
  searchFiltered?: boolean;
  addDisabled: boolean;
  native?: boolean;
  keyboardRaised?: boolean;
}
import type { AppMode } from '../App';


/** Accessible navigation for the two swipeable library pages. */
export interface LibraryPagePositionProps {
  mode: AppMode;
  onChange: (mode: AppMode) => void;
  /** Continuous Study (0) to Practice (1) gesture position. */
  pageProgress?: number;
  /** Ease a released/cancelled gesture to its controlled dot. */
  returning?: boolean;
}
