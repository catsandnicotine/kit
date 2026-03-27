/**
 * Sync layer types — data formats for the per-deck change-log sync system.
 *
 * Edit files are tiny JSON documents (~100-500 bytes) written to iCloud after
 * every user action. Other devices pick them up via NSMetadataQuery and replay
 * them onto their local SQLite cache.
 *
 * Snapshots are compacted representations of the full deck state, created by
 * merging all edit files up to a certain HLC.
 */

import type {
  Card,
  CardState,
  Deck,
  DeckTag,
  Note,
  NoteType,
  Rating,
} from '../../types';

// ---------------------------------------------------------------------------
// Deck Settings (inline to avoid circular deps with db layer)
// ---------------------------------------------------------------------------

/** Per-deck study settings stored in the snapshot. */
export interface SyncDeckSettings {
  deckId: string;
  newCardsPerDay: number;
  maxReviewsPerDay: number;
  againSteps: number[];
  graduatingInterval: number;
  easyInterval: number;
  maxInterval: number;
  leechThreshold: number;
  desiredRetention: number;
}

// ---------------------------------------------------------------------------
// Edit Operations
// ---------------------------------------------------------------------------

/** A review was recorded. Includes the full resulting CardState so replaying
 *  devices don't need to re-run FSRS math. */
export interface ReviewOp {
  type: 'review';
  cardId: string;
  rating: Rating;
  reviewedAt: number;
  elapsed: number;
  scheduledDays: number;
  /** Complete CardState after the review was applied. */
  newState: CardState;
  /** UUID of the review_log row. */
  logId: string;
}

/** A new card was added to the deck. */
export interface CardAddOp {
  type: 'card_add';
  card: Card;
  state?: CardState;
}

/** One or more fields of an existing card were edited. */
export interface CardEditOp {
  type: 'card_edit';
  cardId: string;
  fields: Partial<Pick<Card, 'front' | 'back' | 'tags'>>;
  updatedAt: number;
}

/** A card was deleted. */
export interface CardDeleteOp {
  type: 'card_delete';
  cardId: string;
}

/** A card's suspended flag was toggled. */
export interface CardSuspendOp {
  type: 'card_suspend';
  cardId: string;
  suspended: boolean;
}

/** The deck was renamed. */
export interface DeckRenameOp {
  type: 'deck_rename';
  name: string;
}

/** Deck study settings were changed. */
export interface DeckSettingsOp {
  type: 'deck_settings';
  settings: Partial<SyncDeckSettings>;
}

/** A tag was created or its color set. */
export interface TagAddOp {
  type: 'tag_add';
  tag: string;
  color?: string;
}

/** A tag was renamed across all cards. */
export interface TagRenameOp {
  type: 'tag_rename';
  oldTag: string;
  newTag: string;
}

/** A tag was deleted from all cards. */
export interface TagDeleteOp {
  type: 'tag_delete';
  tag: string;
}

/** A tag was associated with / removed from a deck. */
export interface DeckTagAddOp {
  type: 'deck_tag_add';
  tag: string;
}

export interface DeckTagRemoveOp {
  type: 'deck_tag_remove';
  tag: string;
}

/** A note's fields were edited (triggers card re-render). */
export interface NoteEditOp {
  type: 'note_edit';
  noteId: string;
  fields: Record<string, string>;
  updatedAt: number;
}

/** Union of all possible edit operations. */
export type EditOp =
  | ReviewOp
  | CardAddOp
  | CardEditOp
  | CardDeleteOp
  | CardSuspendOp
  | DeckRenameOp
  | DeckSettingsOp
  | TagAddOp
  | TagRenameOp
  | TagDeleteOp
  | DeckTagAddOp
  | DeckTagRemoveOp
  | NoteEditOp;

// ---------------------------------------------------------------------------
// Edit File
// ---------------------------------------------------------------------------

/**
 * A single edit file written to iCloud.
 * Filename: `{hlc}_{deviceId}.json`
 */
export interface EditFile {
  /** Format version — always 1. */
  v: 1;
  /** Hybrid logical clock value at write time. */
  hlc: string;
  /** Stable device identifier that produced this edit. */
  deviceId: string;
  /** The deck this edit applies to. */
  deckId: string;
  /** Operations in this edit (usually 1; batched during import). */
  ops: EditOp[];
}

// ---------------------------------------------------------------------------
// Deck Snapshot
// ---------------------------------------------------------------------------

/**
 * Compacted representation of the full deck state.
 * Written to `snapshot.json` after merging edit files.
 */
export interface DeckSnapshot {
  /** Format version — always 1. */
  v: 1;
  /** UUID of the deck. */
  deckId: string;
  /** HLC of the latest edit included in this snapshot. */
  compactedThrough: string;
  /** Filenames of edit files that were merged into this snapshot. */
  mergedEditFiles: string[];
  /** Deck metadata. */
  deck: Deck;
  /** Deck study settings. */
  settings: SyncDeckSettings;
  /** Note types (Anki models). */
  noteTypes: NoteType[];
  /** Notes (raw field content). */
  notes: Note[];
  /** All cards. */
  cards: Card[];
  /** Scheduling state for each card. */
  cardStates: CardState[];
  /** Review history. */
  reviewLogs: Array<{
    id: string;
    cardId: string;
    rating: Rating;
    reviewedAt: number;
    elapsed: number;
    scheduledDays: number;
  }>;
  /** Tag colors. */
  tags: Array<{ tag: string; color: string }>;
  /** Tags associated with this deck. */
  deckTags: string[];
  /** Card IDs that have been soft-deleted (prevents resurrection from stale edits). */
  deletedCardIds: string[];
  /** True if the deck itself was soft-deleted. */
  deleted?: boolean;
}

// ---------------------------------------------------------------------------
// Deck Registry
// ---------------------------------------------------------------------------

/** One entry in the local deck registry (deck_registry.json). */
export interface DeckRegistryEntry {
  /** Deck UUID. */
  deckId: string;
  /** Human-readable deck name (cached). */
  name: string;
  /** Whether this deck has a local SQLite cache. */
  hasLocalDb: boolean;
  /** Whether the iCloud snapshot is downloaded. */
  isDownloaded: boolean;
  /** Cached total card count (from last open). */
  cardCount: number;
  /** Cached new-card count (from last open). */
  newCount?: number;
  /** Cached learning/relearning count (from last open). */
  learningCount?: number;
  /** Cached review-due count (from last open). */
  reviewCount?: number;
  /** Unix timestamp of last local access. */
  lastAccessedAt: number;
  /** Whether the deck is soft-deleted. */
  deleted?: boolean;
}

/** The full deck registry. */
export interface DeckRegistry {
  /** Format version — always 1. */
  v: 1;
  /** Stable device identifier for this device. */
  deviceId: string;
  /** Registry entries keyed by deckId. */
  decks: Record<string, DeckRegistryEntry>;
}
