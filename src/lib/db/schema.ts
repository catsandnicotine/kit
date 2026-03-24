/** SQL schema definitions for Kit's SQLite database */

export const CREATE_DECKS_TABLE = `
  CREATE TABLE IF NOT EXISTS decks (
    id          TEXT    PRIMARY KEY,
    name        TEXT    NOT NULL,
    description TEXT    NOT NULL DEFAULT '',
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );
`;

/**
 * note_types map to Anki models: they describe the field names for a family of notes.
 * Must be created before notes (FK dependency).
 */
export const CREATE_NOTE_TYPES_TABLE = `
  CREATE TABLE IF NOT EXISTS note_types (
    id         TEXT    PRIMARY KEY,
    deck_id    TEXT    NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
    name       TEXT    NOT NULL,
    fields     TEXT    NOT NULL DEFAULT '[]',
    templates  TEXT    NOT NULL DEFAULT '[]',
    css        TEXT    NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );
`;

/**
 * notes store the raw field content imported from an Anki deck.
 * fields is a JSON object: { fieldName: value }.
 * One note can generate multiple cards via templates.
 */
export const CREATE_NOTES_TABLE = `
  CREATE TABLE IF NOT EXISTS notes (
    id           TEXT    PRIMARY KEY,
    deck_id      TEXT    NOT NULL REFERENCES decks(id)      ON DELETE CASCADE,
    note_type_id TEXT    NOT NULL REFERENCES note_types(id) ON DELETE CASCADE,
    fields       TEXT    NOT NULL DEFAULT '{}',
    tags         TEXT    NOT NULL DEFAULT '[]',
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
  );
`;

/**
 * cards hold the rendered front/back content ready for study.
 * note_id is nullable for manually created cards that have no parent note.
 */
export const CREATE_CARDS_TABLE = `
  CREATE TABLE IF NOT EXISTS cards (
    id         TEXT    PRIMARY KEY,
    deck_id    TEXT    NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
    note_id    TEXT             REFERENCES notes(id) ON DELETE CASCADE,
    front      TEXT    NOT NULL,
    back       TEXT    NOT NULL,
    tags       TEXT    NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
`;

export const CREATE_CARD_STATES_TABLE = `
  CREATE TABLE IF NOT EXISTS card_states (
    card_id              TEXT    PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
    due                  INTEGER NOT NULL,
    stability            REAL    NOT NULL DEFAULT 0,
    difficulty           REAL    NOT NULL DEFAULT 0,
    elapsed_days         INTEGER NOT NULL DEFAULT 0,
    scheduled_days       INTEGER NOT NULL DEFAULT 0,
    reps                 INTEGER NOT NULL DEFAULT 0,
    lapses               INTEGER NOT NULL DEFAULT 0,
    state                TEXT    NOT NULL DEFAULT 'new',
    last_review          INTEGER,
    learning_step_index  INTEGER NOT NULL DEFAULT 0,
    suspended            INTEGER NOT NULL DEFAULT 0
  );
`;

export const CREATE_REVIEW_LOGS_TABLE = `
  CREATE TABLE IF NOT EXISTS review_logs (
    id             TEXT    PRIMARY KEY,
    card_id        TEXT    NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    rating         TEXT    NOT NULL,
    reviewed_at    INTEGER NOT NULL,
    elapsed        INTEGER NOT NULL,
    scheduled_days INTEGER NOT NULL
  );
`;

/** Attached media files (images, audio) imported with a deck. */
export const CREATE_MEDIA_TABLE = `
  CREATE TABLE IF NOT EXISTS media (
    id         TEXT    PRIMARY KEY,
    deck_id    TEXT    NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
    filename   TEXT    NOT NULL,
    data       BLOB    NOT NULL,
    mime_type  TEXT    NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );
`;

/** Per-deck settings (new cards/day limit, learning steps, etc.). */
export const CREATE_DECK_SETTINGS_TABLE = `
  CREATE TABLE IF NOT EXISTS deck_settings (
    deck_id              TEXT    PRIMARY KEY REFERENCES decks(id) ON DELETE CASCADE,
    new_cards_per_day    INTEGER NOT NULL DEFAULT 20,
    max_reviews_per_day  INTEGER NOT NULL DEFAULT 200,
    again_steps          TEXT    NOT NULL DEFAULT '[1,10]',
    graduating_interval  INTEGER NOT NULL DEFAULT 1,
    easy_interval        INTEGER NOT NULL DEFAULT 4,
    max_interval         INTEGER NOT NULL DEFAULT 365,
    leech_threshold      INTEGER NOT NULL DEFAULT 8
  );
`;

/** Global app settings (key-value store). */
export const CREATE_APP_SETTINGS_TABLE = `
  CREATE TABLE IF NOT EXISTS app_settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
  );
`;

// ---------------------------------------------------------------------------
// Indexes
// ---------------------------------------------------------------------------

/**
 * Index on cards.deck_id — used by getCardsByDeck, getCardsDueForDeck,
 * and getAllDeckCardCounts. Without this, every deck-scoped query does a
 * full table scan on cards (catastrophic at 30K+ rows).
 */
export const CREATE_IDX_CARDS_DECK = `
  CREATE INDEX IF NOT EXISTS idx_cards_deck_id ON cards(deck_id);
`;

/**
 * Composite index on card_states(state, due) — lets getCardsDueForDeck
 * filter by state and sort by due without a temp B-tree sort. The LEFT JOIN
 * in that query starts from cards (filtered by deck_id via idx_cards_deck_id),
 * then probes card_states by PK (card_id); this index further speeds the
 * WHERE/ORDER BY evaluation on the joined rows.
 */
export const CREATE_IDX_CARD_STATES_STATE_DUE = `
  CREATE INDEX IF NOT EXISTS idx_card_states_state_due ON card_states(state, due);
`;

/**
 * Must be executed on every new SQLite connection before any reads or writes.
 * SQLite disables foreign key enforcement by default; without this, ON DELETE
 * CASCADE silently does nothing and deleteDeck leaves orphaned rows.
 */
export const ENABLE_FOREIGN_KEYS = 'PRAGMA foreign_keys = ON;';

/**
 * Migration: add learning-step columns to deck_settings for existing DBs.
 * Uses ALTER TABLE IF NOT EXISTS pattern via try/catch in the runner.
 */
export const MIGRATE_DECK_SETTINGS_STEPS = [
  `ALTER TABLE deck_settings ADD COLUMN again_steps TEXT NOT NULL DEFAULT '[1,10]'`,
  `ALTER TABLE deck_settings ADD COLUMN graduating_interval INTEGER NOT NULL DEFAULT 1`,
  `ALTER TABLE deck_settings ADD COLUMN easy_interval INTEGER NOT NULL DEFAULT 4`,
];

/** Tables and indexes in dependency order: parent tables first, then indexes. */
export const ALL_TABLES = [
  CREATE_DECKS_TABLE,
  CREATE_NOTE_TYPES_TABLE,
  CREATE_NOTES_TABLE,
  CREATE_CARDS_TABLE,
  CREATE_CARD_STATES_TABLE,
  CREATE_REVIEW_LOGS_TABLE,
  CREATE_MEDIA_TABLE,
  CREATE_DECK_SETTINGS_TABLE,
  CREATE_APP_SETTINGS_TABLE,
  CREATE_IDX_CARDS_DECK,
  CREATE_IDX_CARD_STATES_STATE_DUE,
];
