// Core domain types for Kit

export type Result<T> = { success: true; data: T } | { success: false; error: string };

export interface Deck {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
}

export interface Card {
  id: string;
  deckId: string;
  /** null for manually created cards that have no parent Anki note. */
  noteId: string | null;
  front: string;
  back: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

/** A single card template within a NoteType. */
export interface NoteTemplate {
  name: string;
  ord: number;
  /** Question-side Anki template (may contain {{FieldName}} tokens). */
  qfmt: string;
  /** Answer-side Anki template. */
  afmt: string;
}

/**
 * Anki model / note type: defines field names, card templates, and shared CSS.
 * Templates and CSS are stored so cards can be re-rendered after editing.
 */
export interface NoteType {
  id: string;
  deckId: string;
  name: string;
  /** Ordered list of field names, e.g. ['Front', 'Back', 'Extra']. */
  fields: string[];
  /** Card templates, one per card type generated from this note type. */
  templates: NoteTemplate[];
  /** CSS stylesheet shared by all templates in this note type. */
  css: string;
  createdAt: number;
}

/**
 * An Anki note: raw field content that generates one or more cards.
 * fields maps each field name (from its NoteType) to its value.
 */
export interface Note {
  id: string;
  deckId: string;
  noteTypeId: string;
  fields: Record<string, string>;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

/** A media file attached to a deck (image, audio, etc.). */
export interface Media {
  id: string;
  deckId: string;
  filename: string;
  data: Uint8Array;
  mimeType: string;
  createdAt: number;
}

/** A card joined with its current FSRS scheduling state. */
export interface CardWithState {
  card: Card;
  state: CardState;
}

export interface ReviewLog {
  id: string;
  cardId: string;
  rating: Rating;
  reviewedAt: number;
  elapsed: number;
  scheduledDays: number;
}

export interface CardState {
  cardId: string;
  due: number;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  reps: number;
  lapses: number;
  state: LearningState;
  lastReview: number | null;
  /**
   * Index into the deck's again-steps (minutes) for the next "Good" while in
   * learning/relearning. 0 = next Good applies steps[0], then increments.
   */
  learningStepIndex: number;
  /** Whether the card is suspended (excluded from study). */
  suspended: boolean;
}

export type Rating = 'again' | 'hard' | 'good' | 'easy';

export type LearningState = 'new' | 'learning' | 'review' | 'relearning';

export type Theme = 'light' | 'dark' | 'black';

/** A single daily reminder time (24-hour clock). */
export interface ReminderTime {
  /** Hour in 24-hour format (0–23). */
  hour: number;
  /** Minute (0–59). */
  minute: number;
}

/** Persisted notification preferences for the app. */
export interface NotificationPrefs {
  /** Whether study reminders are enabled. */
  enabled: boolean;
  /** Up to 3 daily reminder times, sorted ascending. */
  times: ReminderTime[];
}

/** Output produced by the FSRS scheduling functions. */
export interface FSRSOutput {
  /** New stability value in days. */
  stability: number;
  /** New difficulty value, clamped to [1, 10]. */
  difficulty: number;
  /** Interval until next review in days (≥ 1). */
  scheduledDays: number;
  /** New learning state after this review. */
  state: LearningState;
  /** Total number of reviews including this one. */
  reps: number;
  /** Total number of lapses including this one (if applicable). */
  lapses: number;
}
