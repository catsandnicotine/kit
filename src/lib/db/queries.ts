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
    // Get the new cards per day limit
    const settingsResult = getDeckSettings(db, deckId);
    const newCardsLimit = settingsResult.success ? settingsResult.data.newCardsPerDay : 20;

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
    let newCardsSeen = 0;
    while (stmt.step()) {
      const row = stmt.getAsObject() as Row;
      const card  = toCard(row);
      const state = row['state'] !== null && row['state'] !== undefined
        ? toCardState(row, card.id)
        : defaultCardState(card.id);

      // Enforce new cards per day limit
      if (state.state === 'new') {
        newCardsSeen++;
        if (newCardsSeen > newCardsRemaining) continue;
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
export function getMediaByDeck(db: Database, deckId: string): Result<MediaBlob[]> {
  try {
    const stmt = db.prepare(
      'SELECT filename, data, mime_type FROM media WHERE deck_id = ?',
    );
    stmt.bind([deckId]);
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
        SUM(CASE WHEN cs.state IN ('learning', 'relearning')  THEN 1 ELSE 0 END) AS learning_count,
        SUM(CASE WHEN cs.state = 'review' AND cs.due <= ?     THEN 1 ELSE 0 END) AS review_count
      FROM cards c
      LEFT JOIN card_states cs ON c.id = cs.card_id
      GROUP BY c.deck_id
    `);
    stmt.bind([now]);

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
      'SELECT new_cards_per_day FROM deck_settings WHERE deck_id = ?',
    );
    stmt.bind([deckId]);
    if (stmt.step()) {
      const row = stmt.getAsObject() as Row;
      stmt.free();
      return {
        success: true,
        data: { deckId, newCardsPerDay: num(row, 'new_cards_per_day') },
      };
    }
    stmt.free();
    return { success: true, data: { deckId, newCardsPerDay: 20 } };
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
        SUM(CASE WHEN cs.state IN ('learning', 'relearning')  THEN 1 ELSE 0 END) AS learning_count,
        SUM(CASE WHEN cs.state = 'review'                     THEN 1 ELSE 0 END) AS review_count
      FROM cards c
      LEFT JOIN card_states cs ON c.id = cs.card_id
      WHERE c.deck_id = ?
    `);
    countStmt.bind([deckId]);
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
