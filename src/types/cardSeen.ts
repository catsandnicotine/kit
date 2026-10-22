/** The scheduling-free distinction attached to a recorded viewing session. */
export type CardSeenMode = 'study' | 'practice';

/** Sparse counts only; no card content, timestamps, ratings or scheduling state. */
export interface CardSeenComponent {
  v: 1;
  kind: 'total';
  deckId: string;
  deviceId: string;
  counts: Record<string, number>;
  /** Resetter-owned observations of each writer's lifetime count, keyed by card. */
  resets?: Record<string, Record<string, number>>;
}

/** One independent session, with occurrence keys for durable retry deduplication. */
export interface CardSeenSession {
  v: 1;
  kind: 'session';
  deckId: string;
  deviceId: string;
  sessionId: string;
  mode: CardSeenMode;
  counts: Record<string, number>;
  occurrences: Record<string, string>;
}

/** UI exposes a resettable reveal total; historical session counts remain unchanged. */
export interface CardSeenStats {
  /** Kept as lifetime for compatibility; this is the total above observed reset baselines. */
  lifetime: number;
  session: number;
}

/** Relative-path file port; native calls stay in the platform adapter. */
export interface CardSeenFileStorage {
  readFile(path: string): Promise<string | null>;
  writeFile(path: string, data: string): Promise<void>;
  listDirectory(path: string): Promise<string[]>;
  deleteFile(path: string): Promise<void>;
}

export interface CardSeenSessionInput { deckId: string; mode: CardSeenMode }
export interface CardSeenRecordInput { deckId: string; sessionId: string; cardId: string; occurrenceId: string }
export interface CardSeenStatsInput { deckId: string; cardId: string; sessionId?: string }
export interface CardSeenResetInput { deckId: string; cardId: string }
export interface CardSeenFileChange { path: string; event: string }
export interface CardSeenRemotePath { deckId: string; localPath: string; kind: 'total' | 'session'; id: string }

/** Injected ports make recovery, offline retries and concurrent changes testable. */
export interface CardSeenConfig {
  deviceId: string;
  local: CardSeenFileStorage;
  remote?: CardSeenFileStorage;
  makeSessionId?: () => string;
  debounceMs?: number;
  maxWaitMs?: number;
  canSync?: () => boolean;
  onBackgroundError?: (error: unknown) => void;
}

/** A reveal transaction includes one session; a count-only reset includes none. */
export interface CardSeenJournal {
  v: 1;
  component: CardSeenComponent;
  session: CardSeenSession | null;
  pending: string[];
}

export interface CardSeenStore {
  readonly deviceId: string;
  readonly ready: Promise<void>;
  recover(): Promise<void>;
  load(deckId: string): Promise<void>;
  startSession(input: CardSeenSessionInput): Promise<string>;
  record(input: CardSeenRecordInput): Promise<CardSeenStats>;
  reset(input: CardSeenResetInput): Promise<CardSeenStats>;
  getStats(input: CardSeenStatsInput): CardSeenStats;
  subscribe(listener: () => void): () => void;
  flush(): Promise<void>;
  refresh(deckId: string): Promise<void>;
  handleChanges(changes: readonly CardSeenFileChange[], activeDeckId?: string): Promise<void>;
  removeDeck(deckId: string): Promise<void>;
  dispose(): void;
}
