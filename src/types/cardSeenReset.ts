import type { CardSeenStats } from './cardSeen';

/** A reset belongs to one existing card, separately from its scheduling state. */
export interface CardSeenResetIdentity {
  deckId: string;
  cardId: string;
}

export type CardSeenResetPhase = 'loading' | 'ready' | 'confirming' | 'resetting';

export interface CardSeenResetSnapshot {
  cardKey: string | null;
  lifetime: number | null;
  phase: CardSeenResetPhase;
  error: string | null;
  status: string | null;
}

/** Count-only storage and feedback ports; no content or FSRS writer is accepted. */
export interface CardSeenResetGateway {
  load: (deckId: string) => Promise<void>;
  read: (identity: CardSeenResetIdentity) => CardSeenStats;
  reset: (identity: CardSeenResetIdentity) => Promise<CardSeenStats>;
  subscribe: (listener: () => void) => () => void;
  onReset: () => void;
}

export interface CardSeenResetOptions extends CardSeenResetIdentity {
  enabled: boolean;
}
