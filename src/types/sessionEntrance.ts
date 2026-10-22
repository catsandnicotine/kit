import type { RefObject } from 'react';

export interface SessionEntranceOptions {
  /** A new deck entry resets readiness; flips and next cards keep this identity. */
  identity: string;
  ready: boolean;
  contentKey: string;
  rootRef: RefObject<HTMLDivElement | null>;
}

export interface SessionEntranceState {
  identity: string;
  ready: boolean;
}

export interface SessionEntranceBudget {
  identity: string;
  deadline: number;
}
