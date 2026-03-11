/**
 * All database query functions for Kit.
 *
 * Rules:
 *  - Every function accepts a sql.js Database as its first argument.
 *  - All queries are parameterized — no string interpolation.
 *  - Every function returns Result<T>; errors are never swallowed.
 *  - SQL is never written outside this file.
 */

import type { Database, SqlValue } from 'sql.js';
import type {
  Card,
  CardState,
  CardWithState,
  Deck,
  FSRSOutput,
  LearningState,
  Media,
  Note,
  NoteTemplate,
  NoteType,
  Rating,
  Result,
  ReviewLog,
} from '../../types';

// ---------------------------------------------------------------------------
// Internal row type
// ---------------------------------------------------------------------------

type Row = Record<string, SqlValue>;

// ---------------------------------------------------------------------------
// Type-safe column accessors
// ---------------------------------------------------------------------------

/** Read a string column; returns '' if null. */
function str(row: Row, col: string): string {
  const v = row[col];
  return v === null || v === undefined ? '' : String(v);
}

/** Read a required number column. */
function num(row: Row, col: string): number {
  const v = row[col];
  return v === null || v === undefined ? 0 : Number(v);
}

/** Read a nullable number column. */
function maybeNum(row: Row, col: string): number | null {
  const v = row[col];
  return v === null || v === undefined ? null : Number(v);
}

/** Read a nullable string column. */
function maybeStr(row: Row, col: string): string | null {
  const v = row[col];
  return v === null || v === undefined ? null : String(v);
}

/** Parse a JSON-encoded string array column. */
function jsonStrArray(row: Row, col: string): string[] {
  try {
    const parsed = JSON.parse(str(row, col));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Parse a JSON-encoded string-to-string object column. */
function jsonStrRecord(row: Row, col: string): Record<string, string> {
  try {
    const parsed = JSON.parse(str(row, col));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, string>)
      : {};
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Row → domain type mappers
// ---------------------------------------------------------------------------

function toDeck(row: Row): Deck {
  return {
    id:          str(row, 'id'),
    name:        str(row, 'name'),
    description: str(row, 'description'),
    createdAt:   num(row, 'created_at'),
    updatedAt:   num(row, 'updated_at'),
  };
}

function toCard(row: Row): Card {
  return {
    id:        str(row, 'id'),
    deckId:    str(row, 'deck_id'),
    noteId:    maybeStr(row, 'note_id'),
    front:     str(row, 'front'),
    back:      str(row, 'back'),
    tags:      jsonStrArray(row, 'tags'),
    createdAt: num(row, 'created_at'),
    updatedAt: num(row, 'updated_at'),
  };
}

function toCardState(row: Row, cardId: string): CardState {
  return {
    cardId:        cardId,
    due:           num(row, 'due'),
    stability:     num(row, 'stability'),
    difficulty:    num(row, 'difficulty'),
    elapsedDays:   num(row, 'elapsed_days'),
    scheduledDays: num(row, 'scheduled_days'),
    reps:          num(row, 'reps'),
    lapses:        num(row, 'lapses'),
    state:         str(row, 'state') as LearningState,
    lastReview:    maybeNum(row, 'last_review'),
  };
}

/**
 * Synthesize a default 'new' CardState for a card that has never been reviewed.
 * @param cardId - ID of the card.
 * @returns A CardState with all FSRS fields at their zero-state defaults.
 */
function defaultCardState(cardId: string): CardState {
  return {
    cardId,
    due:           0,
    stability:     0,
    difficulty:    0,
    elapsedDays:   0,
    scheduledDays: 0,
    reps:          0,
    lapses:        0,
    state:         'new',
    lastReview:    null,
  };
}

function toNote(row: Row): Note {
  return {
    id:         str(row, 'id'),
    deckId:     str(row, 'deck_id'),
    noteTypeId: str(row, 'note_type_id'),
    fields:     jsonStrRecord(row, 'fields'),
    tags:       jsonStrArray(row, 'tags'),
    createdAt:  num(row, 'created_at'),
    updatedAt:  num(row, 'updated_at'),
  };
}

function toNoteType(row: Row): NoteType {
  return {
    id:        str(row, 'id'),
    deckId:    str(row, 'deck_id'),
    name:      str(row, 'name'),
    fields:    jsonStrArray(row, 'fields'),
    templates: jsonNoteTemplates(row, 'templates'),
    css:       str(row, 'css'),
    createdAt: num(row, 'created_at'),
  };
}

/** Parse a JSON-encoded NoteTemplate array column. */
function jsonNoteTemplates(row: Row, col: string): NoteTemplate[] {
  try {
    const parsed = JSON.parse(str(row, col));
    if (!Array.isArray(parsed)) return [];
    return parsed.map((t: Record<string, unknown>) => ({
      name: String(t['name'] ?? ''),
      ord:  Number(t['ord']  ?? 0),
      qfmt: String(t['qfmt'] ?? ''),
      afmt: String(t['afmt'] ?? ''),
    }));
  } catch {
    return [];
  }
}

function toReviewLog(row: Row): ReviewLog {
  return {
    id:            str(row, 'id'),
    cardId:        str(row, 'card_id'),
    rating:        str(row, 'rating') as Rating,
    reviewedAt:    num(row, 'reviewed_at'),
    elapsed:       num(row, 'elapsed'),
    scheduledDays: num(row, 'scheduled_days'),
  };
}

// ---------------------------------------------------------------------------
// Deck queries
// ---------------------------------------------------------------------------

/**
 * Fetch all decks ordered by name.
 * @param db - sql.js Database instance.
 * @returns All decks, or an error.
 */
export function getAllDecks(db: Database): Result<Deck[]> {
  try {
    const stmt = db.prepare('SELECT * FROM decks ORDER BY name ASC');
    const decks: Deck[] = [];
    while (stmt.step()) decks.push(toDeck(stmt.getAsObject() as Row));
    stmt.free();
    return { success: true, data: decks };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

/**
 * Fetch a single deck by its ID.
 * @param db - sql.js Database instance.
 * @param id - Deck UUID.
 * @returns The deck, null if not found, or an error.
 */
export function getDeckById(db: Database, id: string): Result<Deck | null> {
  try {
    const stmt = db.prepare('SELECT * FROM decks WHERE id = ?');
    stmt.bind([id]);
    const found = stmt.step() ? toDeck(stmt.getAsObject() as Row) : null;
    stmt.free();
    return { success: true, data: found };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

/**
 * Insert a new deck.
 * @param db   - sql.js Database instance.
 * @param deck - Fully-formed deck (caller provides UUID).
 * @returns void on success, or an error.
 */
export function insertDeck(db: Database, deck: Deck): Result<void> {
  try {
    db.run(
      'INSERT INTO decks (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      [deck.id, deck.name, deck.description, deck.createdAt, deck.updatedAt],
    );
    return { success: true, data: undefined };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

/**
 * Delete a deck and all its child records (notes, cards, media, logs) via CASCADE.
 * @param db - sql.js Database instance.
 * @param id - Deck UUID.
 * @returns void on success, or an error.
 */
export function deleteDeck(db: Database, id: string): Result<void> {
  try {
    db.run('DELETE FROM decks WHERE id = ?', [id]);
    return { success: true, data: undefined };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

// ---------------------------------------------------------------------------
// Card queries
// ---------------------------------------------------------------------------

/**
 * Fetch all cards belonging to a deck.
 * @param db     - sql.js Database instance.
 * @param deckId - Deck UUID.
 * @returns All cards in the deck, or an error.
 */
export function getCardsByDeck(db: Database, deckId: string): Result<Card[]> {
  try {
    const stmt = db.prepare(
      'SELECT * FROM cards WHERE deck_id = ? ORDER BY created_at ASC',
    );
    stmt.bind([deckId]);
    const cards: Card[] = [];
    while (stmt.step()) cards.push(toCard(stmt.getAsObject() as Row));
    stmt.free();
    return { success: true, data: cards };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

/**
 * Fetch cards due for study in a deck, joined with their FSRS state.
 *
 * Returns three categories in priority order:
 *  1. New cards (no state row, or state = 'new')
 *  2. Cards in learning or relearning (due any time — these should not be skipped)
 *  3. Review cards whose due timestamp ≤ now
 *
 * @param db     - sql.js Database instance.
 * @param deckId - Deck UUID.
 * @param now    - Current Unix timestamp in seconds.
 * @returns Due cards with their states, or an error.
 */
export function getCardsDueForDeck(
  db: Database,
  deckId: string,
  now: number,
): Result<CardWithState[]> {
  try {
    const stmt = db.prepare(`
      SELECT
        c.id,  c.deck_id,  c.note_id,  c.front,  c.back,
        c.tags, c.created_at, c.updated_at,
        cs.due,            cs.stability,   cs.difficulty,
        cs.elapsed_days,   cs.scheduled_days,
        cs.reps,           cs.lapses,
        cs.state,          cs.last_review
      FROM cards c
      LEFT JOIN card_states cs ON c.id = cs.card_id
      WHERE c.deck_id = ?
        AND (
              cs.card_id IS NULL
           OR cs.state IN ('new', 'learning', 'relearning')
           OR cs.due <= ?
        )
      ORDER BY
        CASE
          WHEN cs.card_id IS NULL OR cs.state = 'new' THEN 0
          WHEN cs.state IN ('learning', 'relearning')  THEN 1
          ELSE 2
        END,
        cs.due ASC
    `);
    stmt.bind([deckId, now]);
    const results: CardWithState[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as Row;
      const card  = toCard(row);
      const state = row['state'] !== null && row['state'] !== undefined
        ? toCardState(row, card.id)
        : defaultCardState(card.id);
      results.push({ card, state });
    }
    stmt.free();
    return { success: true, data: results };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

/**
 * Insert a new card.
 * @param db   - sql.js Database instance.
 * @param card - Fully-formed card (caller provides UUID).
 * @returns void on success, or an error.
 */
export function insertCard(db: Database, card: Card): Result<void> {
  try {
    db.run(
      `INSERT INTO cards
         (id, deck_id, note_id, front, back, tags, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        card.id,
        card.deckId,
        card.noteId,
        card.front,
        card.back,
        JSON.stringify(card.tags),
        card.createdAt,
        card.updatedAt,
      ],
    );
    return { success: true, data: undefined };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

/**
 * Delete a single card and its state/logs via CASCADE.
 * @param db - sql.js Database instance.
 * @param id - Card UUID.
 * @returns void on success, or an error.
 */
export function deleteCard(db: Database, id: string): Result<void> {
  try {
    db.run('DELETE FROM cards WHERE id = ?', [id]);
    return { success: true, data: undefined };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

/**
 * Full-text search across card front/back and the fields of any linked note.
 * The search is case-insensitive and matches partial strings.
 *
 * @param db    - sql.js Database instance.
 * @param query - Search string (whitespace is trimmed; empty string returns all).
 * @returns Matching cards ordered by most recently updated, or an error.
 */
export function searchCards(db: Database, query: string): Result<Card[]> {
  try {
    const trimmed = query.trim();
    if (trimmed === '') {
      return getCardsByAll(db);
    }
    const like = `%${trimmed}%`;
    const stmt = db.prepare(`
      SELECT DISTINCT
        c.id, c.deck_id, c.note_id, c.front, c.back,
        c.tags, c.created_at, c.updated_at
      FROM cards c
      LEFT JOIN notes n ON c.note_id = n.id
      WHERE c.front  LIKE ? ESCAPE '\\'
         OR c.back   LIKE ? ESCAPE '\\'
         OR n.fields LIKE ? ESCAPE '\\'
      ORDER BY c.updated_at DESC
    `);
    stmt.bind([like, like, like]);
    const cards: Card[] = [];
    while (stmt.step()) cards.push(toCard(stmt.getAsObject() as Row));
    stmt.free();
    return { success: true, data: cards };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

/** Internal: return every card ordered by updated_at DESC (used by empty search). */
function getCardsByAll(db: Database): Result<Card[]> {
  try {
    const stmt = db.prepare('SELECT * FROM cards ORDER BY updated_at DESC');
    const cards: Card[] = [];
    while (stmt.step()) cards.push(toCard(stmt.getAsObject() as Row));
    stmt.free();
    return { success: true, data: cards };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

// ---------------------------------------------------------------------------
// Card state queries
// ---------------------------------------------------------------------------

/**
 * Persist the FSRS scheduling output after a card review.
 *
 * Uses INSERT OR REPLACE so the function works for both the first review of a
 * new card and subsequent reviews.
 *
 * @param db          - sql.js Database instance.
 * @param cardId      - Card UUID.
 * @param fsrsOutput  - Scheduling output from {@link reviewCard} or {@link initializeCard}.
 * @param reviewedAt  - Unix timestamp (seconds) when the review occurred.
 * @param elapsedDays - Days elapsed since the previous review (0 for first review).
 * @returns The newly persisted CardState, or an error.
 */
export function updateCardAfterReview(
  db: Database,
  cardId: string,
  fsrsOutput: FSRSOutput,
  reviewedAt: number,
  elapsedDays: number,
): Result<CardState> {
  try {
    const due = reviewedAt + fsrsOutput.scheduledDays * 86400;
    db.run(
      `INSERT OR REPLACE INTO card_states
         (card_id, due, stability, difficulty, elapsed_days, scheduled_days,
          reps, lapses, state, last_review)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        cardId,
        due,
        fsrsOutput.stability,
        fsrsOutput.difficulty,
        elapsedDays,
        fsrsOutput.scheduledDays,
        fsrsOutput.reps,
        fsrsOutput.lapses,
        fsrsOutput.state,
        reviewedAt,
      ],
    );
    const state: CardState = {
      cardId,
      due,
      stability:     fsrsOutput.stability,
      difficulty:    fsrsOutput.difficulty,
      elapsedDays,
      scheduledDays: fsrsOutput.scheduledDays,
      reps:          fsrsOutput.reps,
      lapses:        fsrsOutput.lapses,
      state:         fsrsOutput.state,
      lastReview:    reviewedAt,
    };
    return { success: true, data: state };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

// ---------------------------------------------------------------------------
// Note queries
// ---------------------------------------------------------------------------

/**
 * Fetch a single note by its ID.
 * @param db - sql.js Database instance.
 * @param id - Note UUID.
 * @returns The note, null if not found, or an error.
 */
export function getNoteById(db: Database, id: string): Result<Note | null> {
  try {
    const stmt = db.prepare('SELECT * FROM notes WHERE id = ?');
    stmt.bind([id]);
    const found = stmt.step() ? toNote(stmt.getAsObject() as Row) : null;
    stmt.free();
    return { success: true, data: found };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

/**
 * Insert a new note.
 * @param db   - sql.js Database instance.
 * @param note - Fully-formed note (caller provides UUID).
 * @returns void on success, or an error.
 */
export function insertNote(db: Database, note: Note): Result<void> {
  try {
    db.run(
      `INSERT INTO notes
         (id, deck_id, note_type_id, fields, tags, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        note.id,
        note.deckId,
        note.noteTypeId,
        JSON.stringify(note.fields),
        JSON.stringify(note.tags),
        note.createdAt,
        note.updatedAt,
      ],
    );
    return { success: true, data: undefined };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

/**
 * Update the fields (content) of an existing note.
 * Typically called when the user edits a card during a study session.
 *
 * @param db        - sql.js Database instance.
 * @param id        - Note UUID.
 * @param fields    - New field values (must conform to the note's NoteType).
 * @param updatedAt - Unix timestamp (seconds) of the edit.
 * @returns The updated Note, or an error.
 */
export function updateNote(
  db: Database,
  id: string,
  fields: Record<string, string>,
  updatedAt: number,
): Result<Note> {
  try {
    db.run(
      'UPDATE notes SET fields = ?, updated_at = ? WHERE id = ?',
      [JSON.stringify(fields), updatedAt, id],
    );
    const result = getNoteById(db, id);
    if (!result.success) return result;
    if (!result.data) return { success: false, error: `Note ${id} not found after update` };
    return { success: true, data: result.data };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

// ---------------------------------------------------------------------------
// Note type queries
// ---------------------------------------------------------------------------

/**
 * Insert a note type (Anki model).
 * @param db       - sql.js Database instance.
 * @param noteType - Fully-formed NoteType (caller provides UUID).
 * @returns void on success, or an error.
 */
export function insertNoteType(db: Database, noteType: NoteType): Result<void> {
  try {
    db.run(
      'INSERT INTO note_types (id, deck_id, name, fields, templates, css, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        noteType.id,
        noteType.deckId,
        noteType.name,
        JSON.stringify(noteType.fields),
        JSON.stringify(noteType.templates),
        noteType.css,
        noteType.createdAt,
      ],
    );
    return { success: true, data: undefined };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

// ---------------------------------------------------------------------------
// Media queries
// ---------------------------------------------------------------------------

/**
 * Insert a media file attached to a deck.
 * The binary data is stored as a BLOB directly in SQLite.
 *
 * @param db    - sql.js Database instance.
 * @param media - Fully-formed Media record (caller provides UUID).
 * @returns void on success, or an error.
 */
export function insertMedia(db: Database, media: Media): Result<void> {
  try {
    db.run(
      `INSERT INTO media (id, deck_id, filename, data, mime_type, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        media.id,
        media.deckId,
        media.filename,
        media.data,
        media.mimeType,
        media.createdAt,
      ],
    );
    return { success: true, data: undefined };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

// ---------------------------------------------------------------------------
// Review log queries
// ---------------------------------------------------------------------------

/**
 * Append a review log entry. Logs are immutable once written.
 * @param db  - sql.js Database instance.
 * @param log - Fully-formed ReviewLog (caller provides UUID).
 * @returns void on success, or an error.
 */
export function insertReviewLog(db: Database, log: ReviewLog): Result<void> {
  try {
    db.run(
      `INSERT INTO review_logs
         (id, card_id, rating, reviewed_at, elapsed, scheduled_days)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [log.id, log.cardId, log.rating, log.reviewedAt, log.elapsed, log.scheduledDays],
    );
    return { success: true, data: undefined };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

/**
 * Upsert a card_states row. Used by undo to restore the previous state.
 *
 * @param db    - sql.js Database instance.
 * @param state - CardState to write (card_id is the PK).
 * @returns void on success, or an error.
 */
export function setCardState(db: Database, state: CardState): Result<void> {
  try {
    db.run(
      `INSERT OR REPLACE INTO card_states
         (card_id, due, stability, difficulty, elapsed_days, scheduled_days,
          reps, lapses, state, last_review)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        state.cardId,
        state.due,
        state.stability,
        state.difficulty,
        state.elapsedDays,
        state.scheduledDays,
        state.reps,
        state.lapses,
        state.state,
        state.lastReview ?? null,
      ],
    );
    return { success: true, data: undefined };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

/**
 * Delete the card_states row for a card. Used by undo when reverting
 * the very first review of a card (the row did not exist before).
 *
 * @param db     - sql.js Database instance.
 * @param cardId - ID of the card whose state row should be removed.
 * @returns void on success, or an error.
 */
export function deleteCardState(db: Database, cardId: string): Result<void> {
  try {
    db.run('DELETE FROM card_states WHERE card_id = ?', [cardId]);
    return { success: true, data: undefined };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

/**
 * Delete a review_log entry by ID. Used by undo to remove the log
 * written for the rating that is being reverted.
 *
 * @param db       - sql.js Database instance.
 * @param logId    - UUID of the review_log row to delete.
 * @returns void on success, or an error.
 */
export function deleteReviewLog(db: Database, logId: string): Result<void> {
  try {
    db.run('DELETE FROM review_logs WHERE id = ?', [logId]);
    return { success: true, data: undefined };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}
