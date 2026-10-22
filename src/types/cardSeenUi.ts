import type { CardSeenMode, CardSeenStats } from './cardSeen';
import type { CardFace } from './editorUi';

/** One stable queue occurrence; editing or returning to its front keeps this identity. */
export interface CardSeenPresentation {
  deckId: string;
  cardId: string;
  occurrenceId: string;
  sessionKey: string;
  mode: CardSeenMode;
}

export interface CardSeenGateway {
  startSession: (input: { deckId: string; mode: CardSeenMode }) => Promise<string>;
  loadDeck: (deckId: string) => Promise<void>;
  record: (input: { deckId: string; sessionId: string; cardId: string; occurrenceId: string }) => Promise<CardSeenStats>;
  read: (input: { deckId: string; cardId: string }) => CardSeenStats;
  subscribe: (listener: () => void) => () => void;
}

export interface CardSeenSnapshot {
  cardKey: string | null;
  lifetime: number | null;
  error: string | null;
}

export interface UseCardSeenOptions {
  deckId: string | null;
  cardId: string | null;
  occurrenceId: string | null;
  sessionKey: string;
  mode: CardSeenMode;
  face: CardFace;
  enabled: boolean;
  onFlip: () => void;
}

export interface CardSeenCountProps {
  count?: number | null | undefined;
}

export interface CardSeenNoticeProps {
  error: string | null;
  onDismiss: () => void;
}
