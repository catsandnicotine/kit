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
    card_id        TEXT    PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
    due            INTEGER NOT NULL,
    stability      REAL    NOT NULL DEFAULT 0,
    difficulty     REAL    NOT NULL DEFAULT 0,
    elapsed_days   INTEGER NOT NULL DEFAULT 0,
    scheduled_days INTEGER NOT NULL DEFAULT 0,
    reps           INTEGER NOT NULL DEFAULT 0,
    lapses         INTEGER NOT NULL DEFAULT 0,
    state          TEXT    NOT NULL DEFAULT 'new',
    last_review    INTEGER
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

/**
 * Must be executed on every new SQLite connection before any reads or writes.
 * SQLite disables foreign key enforcement by default; without this, ON DELETE
 * CASCADE silently does nothing and deleteDeck leaves orphaned rows.
 */
export const ENABLE_FOREIGN_KEYS = 'PRAGMA foreign_keys = ON;';

/** Tables in dependency order: parent tables first. */
export const ALL_TABLES = [
  CREATE_DECKS_TABLE,
  CREATE_NOTE_TYPES_TABLE,
  CREATE_NOTES_TABLE,
  CREATE_CARDS_TABLE,
  CREATE_CARD_STATES_TABLE,
  CREATE_REVIEW_LOGS_TABLE,
  CREATE_MEDIA_TABLE,
];
