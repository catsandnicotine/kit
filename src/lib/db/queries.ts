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
  LearningState,
  Media,
  Note,
  NoteTemplate,
  NoteType,
  Result,
  ReviewLog,
} from '../../types';
import type { ResolvedCardSchedule } from '../srs/scheduleWithLearningSteps';

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
    cardId:            cardId,
    due:               num(row, 'due'),
    stability:         num(row, 'stability'),
    difficulty:        num(row, 'difficulty'),
    elapsedDays:       num(row, 'elapsed_days'),
    scheduledDays:     num(row, 'scheduled_days'),
    reps:              num(row, 'reps'),
    lapses:            num(row, 'lapses'),
    state:             str(row, 'state') as LearningState,
    lastReview:        maybeNum(row, 'last_review'),
    learningStepIndex: num(row, 'learning_step_index'),
    suspended:         num(row, 'suspended') === 1,
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
    due:               0,
    stability:         0,
    difficulty:        0,
    elapsedDays:       0,
    scheduledDays:     0,
    reps:              0,
    lapses:            0,
    state:             'new',
    lastReview:        null,
    learningStepIndex: 0,
    suspended:         false,
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

// ---------------------------------------------------------------------------
// Transaction helpers
// ---------------------------------------------------------------------------

/**
 * Begin an explicit transaction. All subsequent writes will be batched
 * until {@link commitTransaction} or {@link rollbackTransaction} is called.
 *
 * This is the single biggest SQLite performance lever: without it, every
 * INSERT is an implicit transaction with its own fsync. Wrapping 30K inserts
 * in one transaction turns minutes into seconds.
 *
 * @param db - sql.js Database instance.
 * @returns void on success, or an error.
 */
export function beginTransaction(db: Database): Result<void> {
  try {
    db.run('BEGIN TRANSACTION');
    return { success: true, data: undefined };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

/**
 * Commit the current transaction, persisting all writes since BEGIN.
 *
 * @param db - sql.js Database instance.
 * @returns void on success, or an error.
 */
export function commitTransaction(db: Database): Result<void> {
  try {
    db.run('COMMIT');
    return { success: true, data: undefined };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

/**
 * Roll back the current transaction, discarding all writes since BEGIN.
 *
 * @param db - sql.js Database instance.
 * @returns void on success, or an error.
 */
export function rollbackTransaction(db: Database): Result<void> {
  try {
    db.run('ROLLBACK');
    return { success: true, data: undefined };
  } catch (e) {
    return { success: false, error: String(e) };
  }
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
 * Rename a deck.
 *
 * @param db        - sql.js Database instance.
 * @param id        - Deck UUID.
 * @param name      - New deck name.
 * @param updatedAt - Unix timestamp (seconds).
 * @returns The updated Deck on success, or an error.
 */
export function renameDeck(
  db: Database,
  id: string,
  name: string,
  updatedAt: number,
): Result<Deck> {
  try {
    db.run(
      'UPDATE decks SET name = ?, updated_at = ? WHERE id = ?',
      [name, updatedAt, id],
    );
    const result = getDeckById(db, id);
    if (!result.success) return result;
    if (!result.data) return { success: false, error: 'Deck not found after rename.' };
    return { success: true, data: result.data };
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
 *  1. New cards (no state row, or state = 'new') — limited by newCardsPerDay setting
 *  2. Cards in learning or relearning with due ≤ now (minute steps respected)
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
    const settingsResult = getDeckSettings(db, deckId);
    const settings = settingsResult.success ? settingsResult.data : null;
    const newCardsLimit = settings?.newCardsPerDay ?? 20;
    const maxReviews = settings?.maxReviewsPerDay ?? 200;

    // Count how many new cards were already studied today
    const todayResult = getNewCardsStudiedToday(db, deckId, now);
    const studiedToday = todayResult.success ? todayResult.data : 0;
    const newCardsRemaining = Math.max(0, newCardsLimit - studiedToday);

    const stmt = db.prepare(`
      SELECT
        c.id,  c.deck_id,  c.note_id,  c.front,  c.back,
        c.tags, c.created_at, c.updated_at,
        cs.due,            cs.stability,   cs.difficulty,
        cs.elapsed_days,   cs.scheduled_days,
        cs.reps,           cs.lapses,
        cs.state,          cs.last_review, cs.learning_step_index,
        COALESCE(cs.suspended, 0) AS suspended
      FROM cards c
      LEFT JOIN card_states cs ON c.id = cs.card_id
      WHERE c.deck_id = ?
        AND COALESCE(cs.suspended, 0) = 0
        AND (
              cs.card_id IS NULL
           OR cs.state = 'new'
           OR (cs.state IN ('learning', 'relearning', 'review') AND cs.due <= ?)
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
    let newCardsSeen = 0;
    let reviewCardsSeen = 0;
    while (stmt.step()) {
      const row = stmt.getAsObject() as Row;
      const card  = toCard(row);
      const state = row['state'] !== null && row['state'] !== undefined
        ? toCardState(row, card.id)
        : defaultCardState(card.id);

      if (state.state === 'new') {
        newCardsSeen++;
        if (newCardsSeen > newCardsRemaining) continue;
      }

      // Enforce max reviews per day (learning/relearning always pass through).
      // Review cards are last in the ORDER BY, so once capped we can stop.
      if (state.state === 'review') {
        reviewCardsSeen++;
        if (reviewCardsSeen > maxReviews) break;
      }

      results.push({ card, state });
    }
    stmt.free();
    return { success: true, data: results };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

/**
 * Fetch reviewed cards that are not yet due, for study-ahead mode.
 * Returns cards ordered by soonest-due first, limited to `limit` cards.
 *
 * @param db     - sql.js Database instance.
 * @param deckId - Deck UUID.
 * @param now    - Current Unix timestamp (seconds).
 * @param limit  - Maximum number of cards to return.
 * @returns Cards with state, or an error.
 */
export function getCardsForStudyAhead(
  db: Database,
  deckId: string,
  now: number,
  limit = 50,
): Result<CardWithState[]> {
  try {
    const stmt = db.prepare(`
      SELECT
        c.id,  c.deck_id,  c.note_id,  c.front,  c.back,
        c.tags, c.created_at, c.updated_at,
        cs.due,            cs.stability,   cs.difficulty,
        cs.elapsed_days,   cs.scheduled_days,
        cs.reps,           cs.lapses,
        cs.state,          cs.last_review, cs.learning_step_index
      FROM cards c
      JOIN card_states cs ON c.id = cs.card_id
      WHERE c.deck_id = ?
        AND cs.state = 'review'
        AND cs.due > ?
      ORDER BY cs.due ASC
      LIMIT ?
    `);
    stmt.bind([deckId, now, limit]);
    const results: CardWithState[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as Row;
      results.push({ card: toCard(row), state: toCardState(row, str(row, 'id')) });
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
 * Update a card's front, back, and tags content.
 * Typically called when the user edits a card during a study session.
 *
 * @param db        - sql.js Database instance.
 * @param id        - Card UUID.
 * @param front     - New front HTML content.
 * @param back      - New back HTML content.
 * @param tags      - New tags array.
 * @param updatedAt - Unix timestamp (seconds) of the edit.
 * @returns The updated Card, or an error.
 */
export function updateCard(
  db: Database,
  id: string,
  front: string,
  back: string,
  tags: string[],
  updatedAt: number,
): Result<Card> {
  try {
    db.run(
      'UPDATE cards SET front = ?, back = ?, tags = ?, updated_at = ? WHERE id = ?',
      [front, back, JSON.stringify(tags), updatedAt, id],
    );
    const stmt = db.prepare('SELECT * FROM cards WHERE id = ?');
    stmt.bind([id]);
    const found = stmt.step() ? toCard(stmt.getAsObject() as Row) : null;
    stmt.free();
    if (!found) return { success: false, error: `Card ${id} not found after update` };
    return { success: true, data: found };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

/**
 * Update only the tags on a card (lightweight — skips front/back).
 *
 * @param db        - sql.js Database instance.
 * @param id        - Card UUID.
 * @param tags      - New tags array.
 * @param updatedAt - Unix timestamp (seconds).
 * @returns The updated Card on success, or an error.
 */
export function updateCardTags(
  db: Database,
  id: string,
  tags: string[],
  updatedAt: number,
): Result<Card> {
  try {
    db.run(
      'UPDATE cards SET tags = ?, updated_at = ? WHERE id = ?',
      [JSON.stringify(tags), updatedAt, id],
    );
    const stmt = db.prepare('SELECT * FROM cards WHERE id = ?');
    stmt.bind([id]);
    const found = stmt.step() ? toCard(stmt.getAsObject() as Row) : null;
    stmt.free();
    if (!found) return { success: false, error: `Card ${id} not found after update` };
    return { success: true, data: found };
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
 * Persist scheduling after a card review (FSRS + learning-step due times).
 *
 * Uses INSERT OR REPLACE so the function works for both the first review of a
 * new card and subsequent reviews.
 *
 * @param db          - sql.js Database instance.
 * @param cardId      - Card UUID.
 * @param schedule    - Resolved schedule from {@link resolveSchedule} in `scheduleWithLearningSteps`.
 * @param reviewedAt  - Unix timestamp (seconds) when the review occurred.
 * @param elapsedDays - Days elapsed since the previous review (0 for first review).
 * @returns The newly persisted CardState, or an error.
 */
export function updateCardAfterReview(
  db: Database,
  cardId: string,
  schedule: ResolvedCardSchedule,
  reviewedAt: number,
  elapsedDays: number,
): Result<CardState> {
  try {
    db.run(
      `INSERT OR REPLACE INTO card_states
         (card_id, due, stability, difficulty, elapsed_days, scheduled_days,
          reps, lapses, state, last_review, learning_step_index)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        cardId,
        schedule.due,
        schedule.stability,
        schedule.difficulty,
        elapsedDays,
        schedule.scheduledDays,
        schedule.reps,
        schedule.lapses,
        schedule.state,
        reviewedAt,
        schedule.learningStepIndex,
      ],
    );
    const state: CardState = {
      cardId,
      due:               schedule.due,
      stability:         schedule.stability,
      difficulty:        schedule.difficulty,
      elapsedDays,
      scheduledDays:     schedule.scheduledDays,
      reps:              schedule.reps,
      lapses:            schedule.lapses,
      state:             schedule.state,
      lastReview:        reviewedAt,
      learningStepIndex: schedule.learningStepIndex,
      suspended:         false,
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
 * Fetch all notes belonging to a deck.
 * @param db     - sql.js Database instance.
 * @param deckId - Deck UUID.
 * @returns All notes in the deck, or an error.
 */
export function getNotesByDeck(db: Database, deckId: string): Result<Note[]> {
  try {
    const stmt = db.prepare('SELECT * FROM notes WHERE deck_id = ? ORDER BY created_at ASC');
    stmt.bind([deckId]);
    const notes: Note[] = [];
    while (stmt.step()) notes.push(toNote(stmt.getAsObject() as Row));
    stmt.free();
    return { success: true, data: notes };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

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

// ---------------------------------------------------------------------------
// Note type queries
// ---------------------------------------------------------------------------

/**
 * Fetch all note types belonging to a deck.
 * @param db     - sql.js Database instance.
 * @param deckId - Deck UUID.
 * @returns All note types in the deck, or an error.
 */
export function getNoteTypesByDeck(db: Database, deckId: string): Result<NoteType[]> {
  try {
    const stmt = db.prepare('SELECT * FROM note_types WHERE deck_id = ? ORDER BY name ASC');
    stmt.bind([deckId]);
    const noteTypes: NoteType[] = [];
    while (stmt.step()) noteTypes.push(toNoteType(stmt.getAsObject() as Row));
    stmt.free();
    return { success: true, data: noteTypes };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

/**
 * Fetch all card states for cards in a given deck.
 * @param db     - sql.js Database instance.
 * @param deckId - Deck UUID.
 * @returns All card states for the deck's cards, or an error.
 */
export function getCardStatesByDeck(db: Database, deckId: string): Result<CardState[]> {
  try {
    const stmt = db.prepare(`
      SELECT cs.*
      FROM card_states cs
      JOIN cards c ON cs.card_id = c.id
      WHERE c.deck_id = ?
    `);
    stmt.bind([deckId]);
    const states: CardState[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as Row;
      states.push(toCardState(row, str(row, 'card_id')));
    }
    stmt.free();
    return { success: true, data: states };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

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

/** Lightweight media record for URL creation — omits id and timestamps. */
export interface MediaBlob {
  filename: string;
  data: Uint8Array;
  mimeType: string;
}

/**
 * Fetch all media blobs for a deck.
 *
 * Returns filename, binary data, and MIME type — everything needed to
 * create object URLs for card rendering.
 *
 * @param db     - sql.js Database instance.
 * @param deckId - Deck UUID.
 * @returns Array of media blobs, or an error.
 */
export function getMediaByDeck(db: Database, _deckId: string): Result<MediaBlob[]> {
  try {
    // Load ALL media regardless of deck_id. Media is stored under the
    // primaryDeckId during import, but cards may belong to sub-decks.
    // Filenames are unique per import so there's no collision risk.
    // The map is keyed by filename, not deck_id.
    const stmt = db.prepare('SELECT filename, data, mime_type FROM media');
    const results: MediaBlob[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as Row;
      const data = row['data'];
      results.push({
        filename: str(row, 'filename'),
        data:     data instanceof Uint8Array ? data : new Uint8Array(),
        mimeType: str(row, 'mime_type'),
      });
    }
    stmt.free();
    return { success: true, data: results };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

/**
 * Fetch the set of all media filenames in the database (no blob data).
 * Used for lazy media loading — only filenames are fetched upfront.
 *
 * @param db - sql.js Database instance.
 * @returns Set of media filenames.
 */
export function getMediaFilenames(db: Database): Result<Set<string>> {
  try {
    const stmt = db.prepare('SELECT filename FROM media');
    const names = new Set<string>();
    while (stmt.step()) {
      const row = stmt.getAsObject() as Row;
      names.add(str(row, 'filename'));
    }
    stmt.free();
    return { success: true, data: names };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

/**
 * Fetch a single media blob by filename.
 * Used for on-demand media loading.
 *
 * @param db       - sql.js Database instance.
 * @param filename - The media filename to fetch.
 * @returns The media blob, or null if not found.
 */
export function getMediaBlobByFilename(db: Database, filename: string): Result<MediaBlob | null> {
  try {
    const stmt = db.prepare('SELECT filename, data, mime_type FROM media WHERE filename = ?');
    stmt.bind([filename]);
    if (stmt.step()) {
      const row = stmt.getAsObject() as Row;
      const data = row['data'];
      stmt.free();
      return {
        success: true,
        data: {
          filename: str(row, 'filename'),
          data: data instanceof Uint8Array ? data : new Uint8Array(),
          mimeType: str(row, 'mime_type'),
        },
      };
    }
    stmt.free();
    return { success: true, data: null };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

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
 * Fetch all review logs for cards belonging to a deck.
 *
 * @param db     - sql.js Database instance.
 * @param deckId - Deck UUID.
 * @returns Array of ReviewLog records on success, or an error.
 */
export function getReviewLogsByDeck(db: Database, deckId: string): Result<ReviewLog[]> {
  try {
    const stmt = db.prepare(`
      SELECT rl.*
      FROM review_logs rl
      JOIN cards c ON rl.card_id = c.id
      WHERE c.deck_id = ?
    `);
    stmt.bind([deckId]);
    const logs: ReviewLog[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as Row;
      logs.push({
        id: str(row, 'id'),
        cardId: str(row, 'card_id'),
        rating: str(row, 'rating') as ReviewLog['rating'],
        reviewedAt: num(row, 'reviewed_at'),
        elapsed: num(row, 'elapsed'),
        scheduledDays: num(row, 'scheduled_days'),
      });
    }
    stmt.free();
    return { success: true, data: logs };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

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
          reps, lapses, state, last_review, learning_step_index, suspended)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        state.learningStepIndex,
        state.suspended ? 1 : 0,
      ],
    );
    return { success: true, data: undefined };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

/**
 * Suspend or unsuspend a card (excluded from study queues).
 *
 * @param db       - sql.js Database instance.
 * @param cardId   - Card UUID.
 * @param suspend  - True to suspend, false to unsuspend.
 * @returns void on success, or an error.
 */
export function setCardSuspended(db: Database, cardId: string, suspend: boolean): Result<void> {
  try {
    db.run(`UPDATE card_states SET suspended = ? WHERE card_id = ?`, [suspend ? 1 : 0, cardId]);
    return { success: true, data: undefined };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

/**
 * Check if a card has reached the leech threshold.
 *
 * @param lapses         - Current lapse count after this review.
 * @param leechThreshold - Deck's configured threshold (0 = disabled).
 * @returns True if the card just became a leech (exactly at threshold or every threshold multiple).
 */
export function isLeech(lapses: number, leechThreshold: number): boolean {
  if (leechThreshold <= 0) return false;
  return lapses >= leechThreshold && lapses % leechThreshold === 0;
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

// ---------------------------------------------------------------------------
// Deck statistics queries
// ---------------------------------------------------------------------------

/** Per-deck card count breakdown by learning state. */
export interface DeckCardCounts {
  deckId: string;
  /** Cards never reviewed (no card_states row, or state = 'new'). */
  newCount: number;
  /** Cards in 'learning' or 'relearning' state. */
  learningCount: number;
  /** Cards in 'review' state that are due now. */
  reviewCount: number;
  /** Total cards in the deck. */
  totalCount: number;
}

/**
 * Get card count breakdowns for all decks.
 *
 * @param db  - sql.js Database instance.
 * @param now - Current Unix timestamp in seconds (for review-due check).
 * @returns Per-deck card counts keyed by deck ID, or an error.
 */
export function getAllDeckCardCounts(
  db: Database,
  now: number,
): Result<Record<string, DeckCardCounts>> {
  try {
    const stmt = db.prepare(`
      SELECT
        c.deck_id,
        COUNT(*)                                                              AS total,
        SUM(CASE WHEN cs.card_id IS NULL OR cs.state = 'new' THEN 1 ELSE 0 END) AS new_count,
        SUM(CASE WHEN cs.state IN ('learning', 'relearning') AND cs.due <= ? THEN 1 ELSE 0 END) AS learning_count,
        SUM(CASE WHEN cs.state = 'review' AND cs.due <= ?     THEN 1 ELSE 0 END) AS review_count
      FROM cards c
      LEFT JOIN card_states cs ON c.id = cs.card_id
      GROUP BY c.deck_id
    `);
    stmt.bind([now, now]);

    const result: Record<string, DeckCardCounts> = {};
    while (stmt.step()) {
      const row = stmt.getAsObject() as Row;
      const deckId = str(row, 'deck_id');
      result[deckId] = {
        deckId,
        newCount:      num(row, 'new_count'),
        learningCount: num(row, 'learning_count'),
        reviewCount:   num(row, 'review_count'),
        totalCount:    num(row, 'total'),
      };
    }
    stmt.free();
    return { success: true, data: result };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

/**
 * Get the total number of cards across all decks.
 *
 * @param db - sql.js Database instance.
 * @returns Total card count, or an error.
 */
export function getTotalCardCount(db: Database): Result<number> {
  try {
    const stmt = db.prepare('SELECT COUNT(*) AS cnt FROM cards');
    stmt.step();
    const row = stmt.getAsObject() as Row;
    const count = num(row, 'cnt');
    stmt.free();
    return { success: true, data: count };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

// ---------------------------------------------------------------------------
// Deck settings queries
// ---------------------------------------------------------------------------

/** Settings for a single deck. */
export interface DeckSettings {
  deckId: string;
  newCardsPerDay: number;
  maxReviewsPerDay: number;
  /** JSON array of step intervals in minutes, e.g. [1, 10]. */
  againSteps: number[];
  /** Graduating interval in days. */
  graduatingInterval: number;
  /** Easy interval in days. */
  easyInterval: number;
  /** Maximum interval in days before a card is shown again. */
  maxInterval: number;
  /** Number of lapses before a card is flagged as a leech. */
  leechThreshold: number;
  /** Target retention rate (0–1). Drives FSRS interval calculation. Default 0.9. */
  desiredRetention: number;
}

/**
 * Get settings for a deck. Returns defaults if no row exists.
 *
 * @param db     - sql.js Database instance.
 * @param deckId - Deck UUID.
 * @returns DeckSettings with current or default values.
 */
export function getDeckSettings(db: Database, deckId: string): Result<DeckSettings> {
  try {
    const stmt = db.prepare(
      `SELECT new_cards_per_day, max_reviews_per_day, again_steps,
              graduating_interval, easy_interval, max_interval, leech_threshold,
              desired_retention
       FROM deck_settings WHERE deck_id = ?`,
    );
    stmt.bind([deckId]);
    if (stmt.step()) {
      const row = stmt.getAsObject() as Row;
      stmt.free();
      let againSteps: number[];
      try {
        const parsed = JSON.parse(str(row, 'again_steps'));
        againSteps = Array.isArray(parsed) ? parsed.map(Number) : [1, 10];
      } catch {
        againSteps = [1, 10];
      }
      return {
        success: true,
        data: {
          deckId,
          newCardsPerDay: num(row, 'new_cards_per_day'),
          maxReviewsPerDay: num(row, 'max_reviews_per_day') || 200,
          againSteps,
          graduatingInterval: num(row, 'graduating_interval') || 1,
          easyInterval: num(row, 'easy_interval') || 4,
          maxInterval: num(row, 'max_interval') || 365,
          leechThreshold: num(row, 'leech_threshold') || 8,
          desiredRetention: num(row, 'desired_retention') || 0.9,
        },
      };
    }
    stmt.free();
    const defaults: DeckSettings = {
      deckId, newCardsPerDay: 20, maxReviewsPerDay: 200, againSteps: [1, 10],
      graduatingInterval: 1, easyInterval: 4, maxInterval: 365, leechThreshold: 8,
      desiredRetention: 0.9,
    };
    return { success: true, data: defaults };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

/**
 * Update the new-cards-per-day setting for a deck.
 *
 * @param db             - sql.js Database instance.
 * @param deckId         - Deck UUID.
 * @param newCardsPerDay - New daily limit (≥ 0).
 * @returns void on success, or an error.
 */
export function setNewCardsPerDay(
  db: Database,
  deckId: string,
  newCardsPerDay: number,
): Result<void> {
  try {
    db.run(
      `INSERT INTO deck_settings (deck_id, new_cards_per_day)
       VALUES (?, ?)
       ON CONFLICT(deck_id) DO UPDATE SET new_cards_per_day = excluded.new_cards_per_day`,
      [deckId, Math.max(0, Math.round(newCardsPerDay))],
    );
    return { success: true, data: undefined };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

/**
 * Update a single deck_settings column by name.
 *
 * @param db      - sql.js Database instance.
 * @param deckId  - UUID of the deck.
 * @param column  - Column to update (validated against allowlist).
 * @param value   - New numeric value.
 * @returns void on success, or an error.
 */
export function setDeckSetting(
  db: Database,
  deckId: string,
  column: 'max_reviews_per_day' | 'max_interval' | 'leech_threshold',
  value: number,
): Result<void> {
  try {
    db.run(
      `INSERT INTO deck_settings (deck_id, ${column})
       VALUES (?, ?)
       ON CONFLICT(deck_id) DO UPDATE SET ${column} = excluded.${column}`,
      [deckId, Math.max(0, Math.round(value))],
    );
    return { success: true, data: undefined };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

/**
 * Set the desired retention rate for a deck (0–1).
 *
 * @param db        - sql.js Database instance.
 * @param deckId    - Deck UUID.
 * @param retention - Target retention (e.g. 0.9 for 90%).
 * @returns void on success, or an error.
 */
export function setDesiredRetention(
  db: Database,
  deckId: string,
  retention: number,
): Result<void> {
  try {
    const clamped = Math.min(0.99, Math.max(0.7, retention));
    db.run(
      `INSERT INTO deck_settings (deck_id, desired_retention)
       VALUES (?, ?)
       ON CONFLICT(deck_id) DO UPDATE SET desired_retention = excluded.desired_retention`,
      [deckId, clamped],
    );
    return { success: true, data: undefined };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

// ---------------------------------------------------------------------------
// Deck statistics queries
// ---------------------------------------------------------------------------

/** Aggregated statistics for a single deck. */
export interface DeckStats {
  totalCards: number;
  newCount: number;
  learningCount: number;
  reviewCount: number;
  totalReviews: number;
  retentionRate: number;
  currentStreak: number;
  /** Reviews per day for the last 7 days, oldest first. [day0, day1, ..., day6]. */
  reviewsPerDay: number[];
  /** Unix timestamp (seconds) of when the next card is due, or null if none. */
  nextDue: number | null;
}

/**
 * Compute comprehensive statistics for a deck.
 *
 * @param db     - sql.js Database instance.
 * @param deckId - Deck UUID.
 * @param now    - Current Unix timestamp in seconds.
 * @returns DeckStats on success, or an error.
 */
export function getDeckStats(
  db: Database,
  deckId: string,
  now: number,
): Result<DeckStats> {
  try {
    // ── Card counts by state ──────────────────────────────────────────
    const countStmt = db.prepare(`
      SELECT
        COUNT(*)                                                              AS total,
        SUM(CASE WHEN cs.card_id IS NULL OR cs.state = 'new' THEN 1 ELSE 0 END) AS new_count,
        SUM(CASE WHEN cs.state IN ('learning', 'relearning') AND cs.due <= ? THEN 1 ELSE 0 END) AS learning_count,
        SUM(CASE WHEN cs.state = 'review'                     THEN 1 ELSE 0 END) AS review_count
      FROM cards c
      LEFT JOIN card_states cs ON c.id = cs.card_id
      WHERE c.deck_id = ?
    `);
    countStmt.bind([now, deckId]);
    countStmt.step();
    const countRow = countStmt.getAsObject() as Row;
    const totalCards = num(countRow, 'total');
    const newCount = num(countRow, 'new_count');
    const learningCount = num(countRow, 'learning_count');
    const reviewCount = num(countRow, 'review_count');
    countStmt.free();

    // ── Total reviews & retention rate ────────────────────────────────
    const reviewStmt = db.prepare(`
      SELECT
        COUNT(*)                                          AS total_reviews,
        SUM(CASE WHEN rating != 'again' THEN 1 ELSE 0 END) AS correct
      FROM review_logs rl
      JOIN cards c ON rl.card_id = c.id
      WHERE c.deck_id = ?
    `);
    reviewStmt.bind([deckId]);
    reviewStmt.step();
    const reviewRow = reviewStmt.getAsObject() as Row;
    const totalReviews = num(reviewRow, 'total_reviews');
    const correct = num(reviewRow, 'correct');
    const retentionRate = totalReviews > 0
      ? Math.round((correct / totalReviews) * 100)
      : 0;
    reviewStmt.free();

    // ── Reviews per day (last 7 days) ─────────────────────────────────
    const daySeconds = 86400;
    const todayStart = now - (now % daySeconds);
    const weekAgo = todayStart - 6 * daySeconds;

    const dailyStmt = db.prepare(`
      SELECT
        CAST((rl.reviewed_at - ?) / 86400 AS INTEGER) AS day_idx,
        COUNT(*) AS cnt
      FROM review_logs rl
      JOIN cards c ON rl.card_id = c.id
      WHERE c.deck_id = ? AND rl.reviewed_at >= ?
      GROUP BY day_idx
    `);
    dailyStmt.bind([weekAgo, deckId, weekAgo]);
    const dailyMap = new Map<number, number>();
    while (dailyStmt.step()) {
      const row = dailyStmt.getAsObject() as Row;
      dailyMap.set(num(row, 'day_idx'), num(row, 'cnt'));
    }
    dailyStmt.free();
    const reviewsPerDay: number[] = [];
    for (let i = 0; i < 7; i++) {
      reviewsPerDay.push(dailyMap.get(i) ?? 0);
    }

    // ── Current streak (consecutive days studied) ─────────────────────
    let currentStreak = 0;
    const streakStmt = db.prepare(`
      SELECT DISTINCT CAST(rl.reviewed_at / 86400 AS INTEGER) AS day
      FROM review_logs rl
      JOIN cards c ON rl.card_id = c.id
      WHERE c.deck_id = ?
      ORDER BY day DESC
    `);
    streakStmt.bind([deckId]);
    const todayDay = Math.floor(now / daySeconds);
    let expectedDay = todayDay;
    while (streakStmt.step()) {
      const row = streakStmt.getAsObject() as Row;
      const day = num(row, 'day');
      if (day === expectedDay) {
        currentStreak++;
        expectedDay--;
      } else if (day === expectedDay + 1) {
        // Same as expected (rounding), skip
        continue;
      } else {
        break;
      }
    }
    streakStmt.free();

    // ── Next due card ─────────────────────────────────────────────────
    const nextDueStmt = db.prepare(`
      SELECT MIN(cs.due) AS next_due
      FROM card_states cs
      JOIN cards c ON cs.card_id = c.id
      WHERE c.deck_id = ? AND cs.state = 'review' AND cs.due > ?
    `);
    nextDueStmt.bind([deckId, now]);
    nextDueStmt.step();
    const nextDueRow = nextDueStmt.getAsObject() as Row;
    const nextDueRaw = nextDueRow['next_due'];
    const nextDue = nextDueRaw !== null && nextDueRaw !== undefined
      ? Number(nextDueRaw)
      : null;
    nextDueStmt.free();

    return {
      success: true,
      data: {
        totalCards,
        newCount,
        learningCount,
        reviewCount,
        totalReviews,
        retentionRate,
        currentStreak,
        reviewsPerDay,
        nextDue,
      },
    };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

/**
 * Update the learning steps for a deck.
 *
 * @param db                  - sql.js Database instance.
 * @param deckId              - Deck UUID.
 * @param againSteps          - Learning step intervals in minutes.
 * @param graduatingInterval  - Graduating interval in days.
 * @param easyInterval        - Easy interval in days.
 * @returns void on success, or an error.
 */
export function setDeckLearningSteps(
  db: Database,
  deckId: string,
  againSteps: number[],
  graduatingInterval: number,
  easyInterval: number,
): Result<void> {
  try {
    db.run(
      `INSERT INTO deck_settings (deck_id, new_cards_per_day, again_steps, graduating_interval, easy_interval)
       VALUES (?, 20, ?, ?, ?)
       ON CONFLICT(deck_id) DO UPDATE SET
         again_steps = excluded.again_steps,
         graduating_interval = excluded.graduating_interval,
         easy_interval = excluded.easy_interval`,
      [deckId, JSON.stringify(againSteps), Math.max(1, Math.round(graduatingInterval)), Math.max(1, Math.round(easyInterval))],
    );
    return { success: true, data: undefined };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

/**
 * Apply learning steps to all existing decks.
 *
 * @param db                  - sql.js Database instance.
 * @param againSteps          - Learning step intervals in minutes.
 * @param graduatingInterval  - Graduating interval in days.
 * @param easyInterval        - Easy interval in days.
 * @returns void on success, or an error.
 */
/**
 * Apply a desired retention rate to all existing decks.
 *
 * @param db        - sql.js Database instance.
 * @param retention - Target retention (0–1).
 * @returns void on success, or an error.
 */
export function applyRetentionToAllDecks(
  db: Database,
  retention: number,
): Result<void> {
  try {
    const clamped = Math.min(0.99, Math.max(0.7, retention));
    db.run(`UPDATE deck_settings SET desired_retention = ?`, [clamped]);
    db.run(
      `INSERT OR IGNORE INTO deck_settings (deck_id, desired_retention)
       SELECT id, ? FROM decks WHERE id NOT IN (SELECT deck_id FROM deck_settings)`,
      [clamped],
    );
    return { success: true, data: undefined };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

export function applyLearningStepsToAllDecks(
  db: Database,
  againSteps: number[],
  graduatingInterval: number,
  easyInterval: number,
): Result<void> {
  try {
    const stepsJson = JSON.stringify(againSteps);
    const gradInt = Math.max(1, Math.round(graduatingInterval));
    const easyInt = Math.max(1, Math.round(easyInterval));
    // First update existing rows
    db.run(
      `UPDATE deck_settings SET again_steps = ?, graduating_interval = ?, easy_interval = ?`,
      [stepsJson, gradInt, easyInt],
    );
    // Then insert for any decks that don't have a settings row yet
    db.run(
      `INSERT OR IGNORE INTO deck_settings (deck_id, new_cards_per_day, again_steps, graduating_interval, easy_interval)
       SELECT id, 20, ?, ?, ? FROM decks WHERE id NOT IN (SELECT deck_id FROM deck_settings)`,
      [stepsJson, gradInt, easyInt],
    );
    return { success: true, data: undefined };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

// ---------------------------------------------------------------------------
// App settings queries
// ---------------------------------------------------------------------------

/**
 * Get a value from the app_settings key-value store.
 *
 * @param db  - sql.js Database instance.
 * @param key - Setting key.
 * @returns The value string, or null if not set.
 */
export function getAppSetting(db: Database, key: string): Result<string | null> {
  try {
    const stmt = db.prepare('SELECT value FROM app_settings WHERE key = ?');
    stmt.bind([key]);
    if (stmt.step()) {
      const row = stmt.getAsObject() as Row;
      stmt.free();
      return { success: true, data: str(row, 'value') };
    }
    stmt.free();
    return { success: true, data: null };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

/**
 * Set a value in the app_settings key-value store.
 *
 * @param db    - sql.js Database instance.
 * @param key   - Setting key.
 * @param value - Value to store.
 * @returns void on success, or an error.
 */
export function setAppSetting(db: Database, key: string, value: string): Result<void> {
  try {
    db.run(
      `INSERT INTO app_settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [key, value],
    );
    return { success: true, data: undefined };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

// ---------------------------------------------------------------------------
// Notification preference queries
// ---------------------------------------------------------------------------

/** Keys used to store notification preferences in app_settings. */
const NOTIF_ENABLED_KEY = 'notification_enabled';
const NOTIF_TIMES_KEY   = 'notification_times';

/**
 * Load notification preferences. Returns safe defaults if no preferences are stored.
 *
 * @param db - sql.js Database instance.
 * @returns NotificationPrefs on success, or an error.
 */
export function getNotificationPrefs(db: Database): Result<import('../../types').NotificationPrefs> {
  try {
    const enabledRes = getAppSetting(db, NOTIF_ENABLED_KEY);
    const timesRes   = getAppSetting(db, NOTIF_TIMES_KEY);

    const enabled = enabledRes.success && enabledRes.data !== null
      ? enabledRes.data === 'true'
      : false;

    let times: import('../../types').ReminderTime[] = [{ hour: 9, minute: 0 }];
    if (timesRes.success && timesRes.data) {
      try {
        const parsed = JSON.parse(timesRes.data);
        if (Array.isArray(parsed) && parsed.length > 0) {
          times = parsed
            .filter((t: unknown) =>
              t !== null && typeof t === 'object' &&
              typeof (t as Record<string, unknown>)['hour'] === 'number' &&
              typeof (t as Record<string, unknown>)['minute'] === 'number',
            )
            .map((t: Record<string, unknown>) => ({
              hour:   Math.max(0, Math.min(23, Math.round(t['hour'] as number))),
              minute: Math.max(0, Math.min(59, Math.round(t['minute'] as number))),
            }))
            .slice(0, 3);
        }
      } catch {
        // Malformed JSON — fall back to default
      }
    }

    return { success: true, data: { enabled, times } };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

/**
 * Persist notification preferences to app_settings.
 *
 * @param db    - sql.js Database instance.
 * @param prefs - Preferences to store.
 * @returns void on success, or an error.
 */
export function setNotificationPrefs(
  db: Database,
  prefs: import('../../types').NotificationPrefs,
): Result<void> {
  try {
    const times = prefs.times.slice(0, 3);
    setAppSetting(db, NOTIF_ENABLED_KEY, prefs.enabled ? 'true' : 'false');
    setAppSetting(db, NOTIF_TIMES_KEY, JSON.stringify(times));
    return { success: true, data: undefined };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

/**
 * Get global statistics across all decks.
 *
 * @param db  - sql.js Database instance.
 * @param now - Current Unix timestamp in seconds.
 * @returns Global stats.
 */
export function getGlobalStats(
  db: Database,
  now: number,
): Result<{ totalCards: number; totalReviews: number; retentionRate: number; currentStreak: number }> {
  try {
    const cardStmt = db.prepare('SELECT COUNT(*) AS cnt FROM cards');
    cardStmt.step();
    const totalCards = num(cardStmt.getAsObject() as Row, 'cnt');
    cardStmt.free();

    const reviewStmt = db.prepare(`
      SELECT
        COUNT(*)                                          AS total_reviews,
        SUM(CASE WHEN rating != 'again' THEN 1 ELSE 0 END) AS correct
      FROM review_logs
    `);
    reviewStmt.step();
    const reviewRow = reviewStmt.getAsObject() as Row;
    const totalReviews = num(reviewRow, 'total_reviews');
    const correct = num(reviewRow, 'correct');
    const retentionRate = totalReviews > 0 ? Math.round((correct / totalReviews) * 100) : 0;
    reviewStmt.free();

    // Current streak: consecutive days with at least one review, counting back from today
    const daySeconds = 86400;
    const todayDay = Math.floor(now / daySeconds);
    const streakStmt = db.prepare(`
      SELECT DISTINCT CAST(reviewed_at / 86400 AS INTEGER) AS day
      FROM review_logs
      WHERE reviewed_at >= ?
      ORDER BY day DESC
    `);
    // Only scan the last 365 days — no realistic streak is longer
    streakStmt.bind([(todayDay - 365) * daySeconds]);
    let currentStreak = 0;
    let expectedDay = todayDay;
    while (streakStmt.step()) {
      const row = streakStmt.getAsObject() as Row;
      const day = num(row, 'day');
      if (day === expectedDay) {
        currentStreak++;
        expectedDay--;
      } else if (day === expectedDay + 1) {
        // Duplicate day bucket, skip
        continue;
      } else {
        break;
      }
    }
    streakStmt.free();

    return { success: true, data: { totalCards, totalReviews, retentionRate, currentStreak } };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

/**
 * Get the number of new cards already studied today for a deck.
 *
 * @param db     - sql.js Database instance.
 * @param deckId - Deck UUID.
 * @param now    - Current Unix timestamp in seconds.
 * @returns Count of new cards studied today.
 */
export function getNewCardsStudiedToday(
  db: Database,
  deckId: string,
  now: number,
): Result<number> {
  try {
    const todayStart = now - (now % 86400);
    const stmt = db.prepare(`
      SELECT COUNT(DISTINCT rl.card_id) AS cnt
      FROM review_logs rl
      JOIN cards c ON rl.card_id = c.id
      JOIN card_states cs ON cs.card_id = rl.card_id
      WHERE c.deck_id = ? AND rl.reviewed_at >= ? AND cs.reps = 1
    `);
    stmt.bind([deckId, todayStart]);
    stmt.step();
    const row = stmt.getAsObject() as Row;
    const count = num(row, 'cnt');
    stmt.free();
    return { success: true, data: count };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

// ---------------------------------------------------------------------------
// Tag operations
// ---------------------------------------------------------------------------

/** A tag string paired with the number of cards that use it. */
export interface TagCount {
  tag: string;
  count: number;
  /** Hex color string set by the user, e.g. `'#FF3B30'`. Empty string = uncoloured. */
  color: string;
}

/**
 * Get all unique tags with card counts and colours, optionally scoped to one deck.
 * Includes standalone tags that exist only in `tag_colors` (count = 0).
 *
 * @param db     - sql.js Database instance.
 * @param deckId - Optional deck UUID to scope card-side counts.
 * @returns Tags sorted alphabetically with their card counts and colours.
 */
export function getAllTagsWithCounts(
  db: Database,
  deckId?: string,
): Result<TagCount[]> {
  try {
    const stmt = deckId
      ? db.prepare('SELECT tags FROM cards WHERE deck_id = ?')
      : db.prepare('SELECT tags FROM cards');
    if (deckId) stmt.bind([deckId]);

    const counts = new Map<string, number>();
    while (stmt.step()) {
      const row = stmt.getAsObject() as Row;
      const raw = str(row, 'tags');
      const tags: string[] = raw ? (JSON.parse(raw) as string[]) : [];
      for (const tag of tags) {
        if (tag) counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    stmt.free();

    // Fetch colours + standalone tags from tag_colors
    const colors = new Map<string, string>();
    try {
      const cr = db.exec('SELECT tag, color FROM tag_colors');
      if (cr.length > 0 && cr[0] !== undefined) {
        for (const row of cr[0].values) {
          const tag = row[0] as string;
          colors.set(tag, row[1] as string);
          // Standalone tags (not on any card) still appear with count 0
          if (!counts.has(tag)) counts.set(tag, 0);
        }
      }
    } catch { /* tag_colors table may not exist on very old installs */ }

    const result: TagCount[] = Array.from(counts.entries())
      .map(([tag, count]) => ({ tag, count, color: colors.get(tag) ?? '' }))
      .sort((a, b) => a.tag.localeCompare(b.tag));

    return { success: true, data: result };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

/**
 * Set or update the colour for a tag (creates the row if it doesn't exist).
 *
 * @param db    - sql.js Database instance.
 * @param tag   - Tag string.
 * @param color - Hex colour (e.g. `'#FF3B30'`) or `''` to clear.
 * @param now   - Current Unix timestamp in seconds.
 */
export function upsertTagColor(
  db: Database,
  tag: string,
  color: string,
  now: number,
): Result<void> {
  try {
    db.run(
      `INSERT INTO tag_colors (tag, color, created_at) VALUES (?, ?, ?)
       ON CONFLICT(tag) DO UPDATE SET color = excluded.color`,
      [tag, color, now],
    );
    return { success: true, data: undefined };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

/**
 * Create a standalone tag (adds to `tag_colors`; no cards required).
 * Does nothing if the tag already exists.
 *
 * @param db    - sql.js Database instance.
 * @param tag   - Tag string to create.
 * @param color - Initial hex colour, or `''` for none.
 * @param now   - Current Unix timestamp in seconds.
 */
export function createStandaloneTag(
  db: Database,
  tag: string,
  color: string,
  now: number,
): Result<void> {
  try {
    db.run(
      `INSERT OR IGNORE INTO tag_colors (tag, color, created_at) VALUES (?, ?, ?)`,
      [tag, color, now],
    );
    return { success: true, data: undefined };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

/**
 * Rename a tag across all cards, optionally scoped to a deck.
 *
 * @param db     - sql.js Database instance.
 * @param oldTag - Tag string to replace.
 * @param newTag - Replacement tag string (trimmed, non-empty).
 * @param now    - Current Unix timestamp in seconds.
 * @param deckId - Optional deck UUID to scope the update.
 * @returns Number of cards affected.
 */
export function renameTagInCards(
  db: Database,
  oldTag: string,
  newTag: string,
  now: number,
  deckId?: string,
): Result<{ affected: number }> {
  try {
    const stmt = deckId
      ? db.prepare('SELECT id, tags FROM cards WHERE deck_id = ?')
      : db.prepare('SELECT id, tags FROM cards');
    if (deckId) stmt.bind([deckId]);

    const toUpdate: { id: string; tags: string[] }[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as Row;
      const raw = str(row, 'tags');
      const tags: string[] = raw ? (JSON.parse(raw) as string[]) : [];
      if (tags.includes(oldTag)) {
        toUpdate.push({ id: str(row, 'id'), tags: tags.map(t => (t === oldTag ? newTag : t)) });
      }
    }
    stmt.free();

    for (const { id, tags } of toUpdate) {
      db.run('UPDATE cards SET tags = ?, updated_at = ? WHERE id = ?', [
        JSON.stringify(tags), now, id,
      ]);
    }

    // Keep deck_tags and tag_colors in sync
    try {
      db.run(`UPDATE deck_tags SET tag = ? WHERE tag = ?`, [newTag, oldTag]);
      db.run(
        `INSERT INTO tag_colors (tag, color, created_at)
         SELECT ?, color, created_at FROM tag_colors WHERE tag = ?
         ON CONFLICT(tag) DO NOTHING`,
        [newTag, oldTag],
      );
      db.run(`DELETE FROM tag_colors WHERE tag = ?`, [oldTag]);
    } catch { /* tables may not exist on very old installs */ }

    return { success: true, data: { affected: toUpdate.length } };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

/**
 * Remove a tag from all cards, optionally scoped to a deck.
 *
 * @param db     - sql.js Database instance.
 * @param tag    - Tag string to remove.
 * @param now    - Current Unix timestamp in seconds.
 * @param deckId - Optional deck UUID to scope the update.
 * @returns Number of cards affected.
 */
export function deleteTagFromCards(
  db: Database,
  tag: string,
  now: number,
  deckId?: string,
): Result<{ affected: number }> {
  try {
    const stmt = deckId
      ? db.prepare('SELECT id, tags FROM cards WHERE deck_id = ?')
      : db.prepare('SELECT id, tags FROM cards');
    if (deckId) stmt.bind([deckId]);

    const toUpdate: { id: string; tags: string[] }[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as Row;
      const raw = str(row, 'tags');
      const tags: string[] = raw ? (JSON.parse(raw) as string[]) : [];
      if (tags.includes(tag)) {
        toUpdate.push({ id: str(row, 'id'), tags: tags.filter(t => t !== tag) });
      }
    }
    stmt.free();

    for (const { id, tags } of toUpdate) {
      db.run('UPDATE cards SET tags = ?, updated_at = ? WHERE id = ?', [
        JSON.stringify(tags), now, id,
      ]);
    }

    // Remove from deck_tags and tag_colors (global delete only — not deck-scoped)
    if (!deckId) {
      try {
        db.run(`DELETE FROM deck_tags WHERE tag = ?`, [tag]);
        db.run(`DELETE FROM tag_colors WHERE tag = ?`, [tag]);
      } catch { /* tables may not exist on very old installs */ }
    }

    return { success: true, data: { affected: toUpdate.length } };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

/**
 * Delete multiple cards by ID (cascades to card_states and review_logs).
 *
 * @param db      - sql.js Database instance.
 * @param cardIds - Array of card UUIDs to delete.
 * @returns void on success.
 */
export function deleteCards(db: Database, cardIds: string[]): Result<void> {
  try {
    for (const id of cardIds) {
      db.run('DELETE FROM cards WHERE id = ?', [id]);
    }
    return { success: true, data: undefined };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

/**
 * Get all cards matching any of the given tags, across all decks.
 *
 * @param db   - sql.js Database instance.
 * @param tags - Tag strings to match (OR logic — any match is sufficient).
 * @returns Cards whose tags array contains at least one of the given tags.
 */
export function getCardsByTags(db: Database, tags: string[]): Result<Card[]> {
  try {
    if (tags.length === 0) return { success: true, data: [] };
    // Pre-filter in SQL using LIKE patterns — avoids loading every card into JS.
    // Tags are stored as JSON arrays, so `"tag"` (with quotes) is a safe discriminator.
    const conditions = tags.map(() => 'tags LIKE ?').join(' OR ');
    const params = tags.map(t => `%"${t}"%`);
    const stmt = db.prepare(
      `SELECT * FROM cards WHERE (${conditions}) ORDER BY created_at ASC`,
    );
    stmt.bind(params);
    const cards: Card[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as Row;
      cards.push(toCard(row));
    }
    stmt.free();
    return { success: true, data: cards };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

/**
 * Insert multiple cards in a single transaction — much faster than N individual inserts.
 *
 * @param db    - sql.js Database instance.
 * @param cards - Array of fully-formed cards (callers provide UUIDs).
 * @returns void on success, or an error (transaction is rolled back on failure).
 */
export function insertCardsBatch(db: Database, cards: Card[]): Result<void> {
  try {
    db.run('BEGIN');
    for (const card of cards) {
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
    }
    db.run('COMMIT');
    return { success: true, data: undefined };
  } catch (e) {
    try { db.run('ROLLBACK'); } catch { /* ignore */ }
    return { success: false, error: String(e) };
  }
}

// ---------------------------------------------------------------------------
// Deck-tag associations
// ---------------------------------------------------------------------------

/**
 * Associate a tag with a deck (add a "marble" to a "bucket").
 * Does nothing if the association already exists.
 *
 * @param db     - sql.js Database instance.
 * @param deckId - Deck UUID.
 * @param tag    - Tag string.
 * @param now    - Current Unix timestamp in seconds.
 */
export function addTagToDeck(
  db: Database,
  deckId: string,
  tag: string,
  now: number,
): Result<void> {
  try {
    db.run(
      `INSERT OR IGNORE INTO deck_tags (deck_id, tag, created_at) VALUES (?, ?, ?)`,
      [deckId, tag, now],
    );
    return { success: true, data: undefined };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

/**
 * Remove a tag association from a deck.
 *
 * @param db     - sql.js Database instance.
 * @param deckId - Deck UUID.
 * @param tag    - Tag string.
 */
export function removeTagFromDeck(
  db: Database,
  deckId: string,
  tag: string,
): Result<void> {
  try {
    db.run(`DELETE FROM deck_tags WHERE deck_id = ? AND tag = ?`, [deckId, tag]);
    return { success: true, data: undefined };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

/**
 * Get all tags associated with a deck, with their colors.
 *
 * @param db     - sql.js Database instance.
 * @param deckId - Deck UUID.
 * @returns Tags sorted alphabetically with colors.
 */
export function getTagsForDeck(
  db: Database,
  deckId: string,
): Result<TagCount[]> {
  try {
    const rows = db.exec(
      `SELECT dt.tag, COALESCE(tc.color, '') AS color
       FROM deck_tags dt
       LEFT JOIN tag_colors tc ON tc.tag = dt.tag
       WHERE dt.deck_id = ?
       ORDER BY dt.tag`,
      [deckId],
    );
    if (rows.length === 0 || rows[0] === undefined) return { success: true, data: [] };
    const data: TagCount[] = rows[0].values.map(r => ({
      tag: String(r[0]),
      count: 0,
      color: String(r[1] ?? ''),
    }));
    return { success: true, data };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

/**
 * Get all decks that have a specific tag associated.
 *
 * @param db  - sql.js Database instance.
 * @param tag - Tag string.
 * @returns Array of deck id + name pairs.
 */
export function getDecksByTag(
  db: Database,
  tag: string,
): Result<{ deckId: string; deckName: string }[]> {
  try {
    const rows = db.exec(
      `SELECT d.id, d.name FROM deck_tags dt
       JOIN decks d ON d.id = dt.deck_id
       WHERE dt.tag = ?
       ORDER BY d.name`,
      [tag],
    );
    if (rows.length === 0 || rows[0] === undefined) return { success: true, data: [] };
    const data = rows[0].values.map(r => ({
      deckId: String(r[0]),
      deckName: String(r[1]),
    }));
    return { success: true, data };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

/**
 * Search for decks whose associated tags contain the query string.
 * Used by home search to show tag-matched decks.
 *
 * @param db    - sql.js Database instance.
 * @param query - Substring to match against tag names (case-insensitive).
 * @returns Array of { deckId, deckName, matchedTag } results.
 */
export function searchDecksByTagLike(
  db: Database,
  query: string,
): Result<{ deckId: string; deckName: string; matchedTag: string }[]> {
  try {
    if (!query.trim()) return { success: true, data: [] };
    const rows = db.exec(
      `SELECT d.id, d.name, dt.tag FROM deck_tags dt
       JOIN decks d ON d.id = dt.deck_id
       WHERE LOWER(dt.tag) LIKE ?
       ORDER BY d.name`,
      [`%${query.toLowerCase()}%`],
    );
    if (rows.length === 0 || rows[0] === undefined) return { success: true, data: [] };
    const data = rows[0].values.map(r => ({
      deckId: String(r[0]),
      deckName: String(r[1]),
      matchedTag: String(r[2]),
    }));
    return { success: true, data };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

/**
 * Return the set of tag names currently in tag_colors.
 * Used during Anki import to detect name collisions.
 *
 * @param db - sql.js Database instance.
 * @returns Set of existing tag name strings.
 */
export function getExistingTagNames(db: Database): Set<string> {
  try {
    const rows = db.exec('SELECT tag FROM tag_colors');
    if (rows.length === 0 || rows[0] === undefined) return new Set();
    return new Set(rows[0].values.map(r => String(r[0])));
  } catch {
    return new Set();
  }
}
