import type { Card } from './index';

export type PracticeChoice = 'again' | 'aside';
export type PracticeDirection = 'previous' | 'next';

export interface PracticeQueueEntry {
  card: Card;
  /** Stable when browsing backward/forward; a repeat receives a fresh identity. */
  occurrenceId: string;
  choice: PracticeChoice | null;
}

export interface PracticeQueue {
  entries: PracticeQueueEntry[];
  index: number;
  initialCount: number;
  /** Unchosen occurrences at or ahead of the cursor; chosen history is excluded. */
  remaining: number;
  putAside: number;
  repeats: number;
}

export interface PracticeNavigationButtonProps {
  direction: PracticeDirection;
  disabled: boolean;
  onNavigate: () => void;
}

export interface PracticeFinishNavigationProps {
  canPrevious: boolean;
  onPrevious: () => void;
}
