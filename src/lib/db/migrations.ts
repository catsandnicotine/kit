/**
 * Schema migration system for Kit.
 *
 * Each migration is a function that receives the database and runs the
 * necessary DDL/DML to move from one version to the next. Migrations
 * are applied in order, tracked by a `schema_version` value in
 * `app_settings`, and are idempotent (safe to re-run).
 *
 * To add a new migration:
 *  1. Append a function to the `MIGRATIONS` array.
 *  2. The array index IS the version number (0-based).
 *     After all migrations run, schema_version = MIGRATIONS.length.
 */

import type { Database } from 'sql.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single migration step. Receives the open database handle. */
type Migration = (db: Database) => void;

// ---------------------------------------------------------------------------
// Migration registry
// ---------------------------------------------------------------------------

/**
 * Ordered list of migrations. Each entry advances the schema by one version.
 *
 * - Index 0 → upgrades schema from version 0 → 1
 * - Index 1 → upgrades schema from version 1 → 2
 * - etc.
 *
 * IMPORTANT: Never reorder or remove entries. Only append new ones.
 */
const MIGRATIONS: Migration[] = [
  // ── v0 → v1: add learning-step columns to deck_settings ──────────────
  (db) => {
    const alters = [
      `ALTER TABLE deck_settings ADD COLUMN again_steps TEXT NOT NULL DEFAULT '[1,10]'`,
      `ALTER TABLE deck_settings ADD COLUMN graduating_interval INTEGER NOT NULL DEFAULT 1`,
      `ALTER TABLE deck_settings ADD COLUMN easy_interval INTEGER NOT NULL DEFAULT 4`,
    ];
    for (const sql of alters) {
      try { db.run(sql); } catch { /* column already exists */ }
    }
  },
  // ── v1 → v2: learning_step_index on card_states (Anki-style minute steps) ─
  (db) => {
    try {
      db.run(
        `ALTER TABLE card_states ADD COLUMN learning_step_index INTEGER NOT NULL DEFAULT 0`,
      );
    } catch {
      /* column already exists */
    }
    // Old builds used 1-day due for learning; bring those cards back to "due now"
    // so the new due-based learning filter does not hide them indefinitely.
    db.run(`
      UPDATE card_states
      SET due = CAST(strftime('%s', 'now') AS INTEGER)
      WHERE state IN ('learning', 'relearning')
    `);
  },
  // ── v2 → v3: suspend, max reviews/day, max interval, leech threshold ──
  (db) => {
    const alters = [
      `ALTER TABLE card_states ADD COLUMN suspended INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE deck_settings ADD COLUMN max_reviews_per_day INTEGER NOT NULL DEFAULT 200`,
      `ALTER TABLE deck_settings ADD COLUMN max_interval INTEGER NOT NULL DEFAULT 365`,
      `ALTER TABLE deck_settings ADD COLUMN leech_threshold INTEGER NOT NULL DEFAULT 8`,
    ];
    for (const sql of alters) {
      try { db.run(sql); } catch { /* column already exists */ }
    }
  },
  // ── v3 → v4: desired_retention per deck ──────────────────────────────
  (db) => {
    try {
      db.run(
        `ALTER TABLE deck_settings ADD COLUMN desired_retention REAL NOT NULL DEFAULT 0.9`,
      );
    } catch { /* column already exists */ }
  },
  // ── v4 → v5: tag_colors — store per-tag colour metadata ───────────────
  (db) => {
    db.run(`
      CREATE TABLE IF NOT EXISTS tag_colors (
        tag        TEXT    PRIMARY KEY,
        color      TEXT    NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL DEFAULT 0
      )
    `);
  },
  // ── v5 → v6: deck_tags — deck-level tag associations ──────────────────
  (db) => {
    db.run(`
      CREATE TABLE IF NOT EXISTS deck_tags (
        deck_id    TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
        tag        TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (deck_id, tag)
      )
    `);
    try {
      db.run(`CREATE INDEX IF NOT EXISTS idx_deck_tags_tag ON deck_tags(tag)`);
    } catch { /* index already exists */ }

    // Backfill: associate every deck with the unique tags already on its cards.
    const now = Math.floor(Date.now() / 1000);
    const decks = db.exec('SELECT id FROM decks');
    if (decks.length > 0 && decks[0] !== undefined) {
      for (const row of decks[0].values) {
        const deckId = String(row[0]);
        const cards = db.exec(`SELECT tags FROM cards WHERE deck_id = ?`, [deckId]);
        if (cards.length === 0 || cards[0] === undefined) continue;
        const seen = new Set<string>();
        for (const cardRow of cards[0].values) {
          try {
            const tags = JSON.parse(String(cardRow[0])) as string[];
            for (const t of tags) if (t) seen.add(t);
          } catch { /* malformed tags */ }
        }
        for (const tag of seen) {
          try {
            db.run(
              `INSERT OR IGNORE INTO deck_tags (deck_id, tag, created_at) VALUES (?, ?, ?)`,
              [deckId, tag, now],
            );
          } catch { /* ignore */ }
        }
      }
    }
  },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Read the current schema version from the database.
 *
 * @param db - Open sql.js Database.
 * @returns Current version number (0 if never migrated).
 */
function getSchemaVersion(db: Database): number {
  try {
    const rows = db.exec(`SELECT value FROM app_settings WHERE key = 'schema_version'`);
    if (rows.length > 0 && rows[0]!.values.length > 0) {
      return parseInt(String(rows[0]!.values[0]![0]), 10) || 0;
    }
  } catch {
    // app_settings table may not exist yet — treat as version 0
  }
  return 0;
}

/**
 * Set the schema version in the database.
 *
 * @param db      - Open sql.js Database.
 * @param version - Version number to store.
 */
function setSchemaVersion(db: Database, version: number): void {
  db.run(
    `INSERT OR REPLACE INTO app_settings (key, value) VALUES ('schema_version', ?)`,
    [String(version)],
  );
}

/**
 * Run all pending schema migrations.
 *
 * Reads the current version, applies each migration in order, and updates
 * the stored version after each successful step. Safe to call on every
 * app launch — it's a no-op when the schema is already up to date.
 *
 * @param db - Open sql.js Database (tables must already be created).
 */
export function runMigrations(db: Database): void {
  const current = getSchemaVersion(db);
  const target = MIGRATIONS.length;

  if (current >= target) return;

  for (let i = current; i < target; i++) {
    MIGRATIONS[i]!(db);
    setSchemaVersion(db, i + 1);
  }
}
