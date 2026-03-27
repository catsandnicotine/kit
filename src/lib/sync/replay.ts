/**
 * replay — applies edit operations onto a local per-deck SQLite database.
 *
 * The replay engine is the core of the sync system. It takes an ordered list
 * of edit files and applies each operation to the local database, handling
 * conflicts with last-writer-wins semantics.
 *
 * Key invariant: replaying the same edit file twice is idempotent.
 * This is achieved by:
 *   - review: review logs use INSERT OR IGNORE (by logId)
 *   - card_add: INSERT OR IGNORE (by card.id)
 *   - card_edit: UPDATE only if updatedAt is newer
 *   - card_delete: soft-delete tracking via deletedCardIds
 *   - card_suspend: unconditional SET (last-writer-wins)
 */

import type { Database } from 'sql.js';
import type { EditFile, EditOp } from './types';
import {
  insertCard,
  updateCard,
  deleteCard,
  setCardState,
  setCardSuspended,
  insertReviewLog,
  renameDeck,
  upsertTagColor,
  renameTagInCards,
  deleteTagFromCards,
  addTagToDeck,
  removeTagFromDeck,
  beginTransaction,
  commitTransaction,
  rollbackTransaction,
} from '../db/queries';
import type { CardState } from '../../types';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Replay a batch of edit files onto a local database.
 *
 * Edit files must be sorted by HLC ascending (oldest first).
 * The entire batch is applied in a single transaction for performance.
 *
 * @param db     - sql.js Database instance for the per-deck local cache.
 * @param edits  - Sorted array of edit files to replay.
 * @param deletedCardIds - Set of card IDs known to be deleted (mutated in place).
 * @returns The HLC of the last successfully replayed edit, or null if none.
 */
export function replayEdits(
  db: Database,
  edits: EditFile[],
  deletedCardIds: Set<string>,
): string | null {
  if (edits.length === 0) return null;

  const txn = beginTransaction(db);
  if (!txn.success) {
    console.warn('[replay] Failed to begin transaction:', txn.error);
    return null;
  }

  let lastHLC: string | null = null;

  try {
    for (const edit of edits) {
      for (const op of edit.ops) {
        replayOp(db, op, edit.deckId, deletedCardIds);
      }
      lastHLC = edit.hlc;
    }

    const commit = commitTransaction(db);
    if (!commit.success) {
      console.warn('[replay] Failed to commit transaction:', commit.error);
      rollbackTransaction(db);
      return null;
    }

    return lastHLC;
  } catch (e) {
    console.warn('[replay] Error during replay, rolling back:', e);
    rollbackTransaction(db);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Per-operation replay
// ---------------------------------------------------------------------------

/**
 * Replay a single edit operation.
 *
 * @param db             - sql.js Database instance.
 * @param op             - The edit operation to apply.
 * @param deckId         - Deck UUID (from the edit file envelope).
 * @param deletedCardIds - Set of soft-deleted card IDs.
 */
function replayOp(
  db: Database,
  op: EditOp,
  deckId: string,
  deletedCardIds: Set<string>,
): void {
  switch (op.type) {
    case 'review':
      replayReview(db, op, deletedCardIds);
      break;
    case 'card_add':
      replayCardAdd(db, op, deletedCardIds);
      break;
    case 'card_edit':
      replayCardEdit(db, op, deletedCardIds);
      break;
    case 'card_delete':
      replayCardDelete(db, op, deletedCardIds);
      break;
    case 'card_suspend':
      replayCardSuspend(db, op, deletedCardIds);
      break;
    case 'deck_rename':
      replayDeckRename(db, op, deckId);
      break;
    case 'deck_settings':
      replayDeckSettings(db, op, deckId);
      break;
    case 'tag_add':
      replayTagAdd(db, op);
      break;
    case 'tag_rename':
      replayTagRename(db, op, deckId);
      break;
    case 'tag_delete':
      replayTagDelete(db, op, deckId);
      break;
    case 'deck_tag_add':
      replayDeckTagAdd(db, op, deckId);
      break;
    case 'deck_tag_remove':
      replayDeckTagRemove(db, op, deckId);
      break;
    case 'note_edit':
      replayNoteEdit(db, op);
      break;
  }
}

// ---------------------------------------------------------------------------
// Individual replay handlers
// ---------------------------------------------------------------------------

function replayReview(
  db: Database,
  op: Extract<EditOp, { type: 'review' }>,
  deletedCardIds: Set<string>,
): void {
  if (deletedCardIds.has(op.cardId)) return;

  // Always insert the review log (idempotent via unique logId)
  try {
    insertReviewLog(db, {
      id: op.logId,
      cardId: op.cardId,
      rating: op.rating,
      reviewedAt: op.reviewedAt,
      elapsed: op.elapsed,
      scheduledDays: op.scheduledDays,
    });
  } catch {
    // Duplicate logId — already replayed, skip
  }

  // Set card state only if this review is newer than current
  setCardStateIfNewer(db, op.newState);
}

function replayCardAdd(
  db: Database,
  op: Extract<EditOp, { type: 'card_add' }>,
  deletedCardIds: Set<string>,
): void {
  // Don't resurrect deleted cards
  if (deletedCardIds.has(op.card.id)) return;

  // INSERT OR IGNORE — if card already exists, skip
  try {
    insertCard(db, op.card);
  } catch {
    // Already exists
  }

  if (op.state) {
    setCardState(db, op.state);
  }
}

function replayCardEdit(
  db: Database,
  op: Extract<EditOp, { type: 'card_edit' }>,
  deletedCardIds: Set<string>,
): void {
  if (deletedCardIds.has(op.cardId)) return;

  // Read current card's updatedAt to check if this edit is newer
  try {
    const rows = db.exec('SELECT updated_at FROM cards WHERE id = ?', [op.cardId]);
    if (!rows.length || !rows[0].values.length) return;
    const currentUpdatedAt = Number(rows[0].values[0][0]);

    if (op.updatedAt > currentUpdatedAt) {
      const front = op.fields.front;
      const back = op.fields.back;
      const tags = op.fields.tags;

      // Build SET clause dynamically based on which fields are present
      if (front !== undefined || back !== undefined || tags !== undefined) {
        updateCard(
          db,
          op.cardId,
          front ?? '',
          back ?? '',
          tags ?? [],
          op.updatedAt,
        );
      }
    }
  } catch (e) {
    console.warn('[replay] card_edit failed:', e);
  }
}

function replayCardDelete(
  db: Database,
  op: Extract<EditOp, { type: 'card_delete' }>,
  deletedCardIds: Set<string>,
): void {
  deletedCardIds.add(op.cardId);
  try {
    deleteCard(db, op.cardId);
  } catch {
    // Already deleted
  }
}

function replayCardSuspend(
  db: Database,
  op: Extract<EditOp, { type: 'card_suspend' }>,
  deletedCardIds: Set<string>,
): void {
  if (deletedCardIds.has(op.cardId)) return;
  setCardSuspended(db, op.cardId, op.suspended);
}

function replayDeckRename(
  db: Database,
  op: Extract<EditOp, { type: 'deck_rename' }>,
  deckId: string,
): void {
  const now = Math.floor(Date.now() / 1000);
  renameDeck(db, deckId, op.name, now);
}

function replayDeckSettings(
  db: Database,
  op: Extract<EditOp, { type: 'deck_settings' }>,
  deckId: string,
): void {
  const s = op.settings;

  // Upsert each setting that is present
  try {
    // Ensure a row exists
    db.run(
      `INSERT OR IGNORE INTO deck_settings (deck_id) VALUES (?)`,
      [deckId],
    );

    const sets: string[] = [];
    const vals: (string | number)[] = [];

    if (s.newCardsPerDay !== undefined) { sets.push('new_cards_per_day = ?'); vals.push(s.newCardsPerDay); }
    if (s.maxReviewsPerDay !== undefined) { sets.push('max_reviews_per_day = ?'); vals.push(s.maxReviewsPerDay); }
    if (s.againSteps !== undefined) { sets.push('again_steps = ?'); vals.push(JSON.stringify(s.againSteps)); }
    if (s.graduatingInterval !== undefined) { sets.push('graduating_interval = ?'); vals.push(s.graduatingInterval); }
    if (s.easyInterval !== undefined) { sets.push('easy_interval = ?'); vals.push(s.easyInterval); }
    if (s.maxInterval !== undefined) { sets.push('max_interval = ?'); vals.push(s.maxInterval); }
    if (s.leechThreshold !== undefined) { sets.push('leech_threshold = ?'); vals.push(s.leechThreshold); }
    if (s.desiredRetention !== undefined) { sets.push('desired_retention = ?'); vals.push(s.desiredRetention); }

    if (sets.length > 0) {
      vals.push(deckId);
      db.run(`UPDATE deck_settings SET ${sets.join(', ')} WHERE deck_id = ?`, vals);
    }
  } catch (e) {
    console.warn('[replay] deck_settings failed:', e);
  }
}

function replayTagAdd(
  db: Database,
  op: Extract<EditOp, { type: 'tag_add' }>,
): void {
  const now = Math.floor(Date.now() / 1000);
  upsertTagColor(db, op.tag, op.color ?? '', now);
}

function replayTagRename(
  db: Database,
  op: Extract<EditOp, { type: 'tag_rename' }>,
  deckId: string,
): void {
  const now = Math.floor(Date.now() / 1000);
  renameTagInCards(db, op.oldTag, op.newTag, now, deckId);
}

function replayTagDelete(
  db: Database,
  op: Extract<EditOp, { type: 'tag_delete' }>,
  deckId: string,
): void {
  const now = Math.floor(Date.now() / 1000);
  deleteTagFromCards(db, op.tag, now, deckId);
}

function replayDeckTagAdd(
  db: Database,
  op: Extract<EditOp, { type: 'deck_tag_add' }>,
  deckId: string,
): void {
  const now = Math.floor(Date.now() / 1000);
  addTagToDeck(db, deckId, op.tag, now);
}

function replayDeckTagRemove(
  db: Database,
  op: Extract<EditOp, { type: 'deck_tag_remove' }>,
  deckId: string,
): void {
  removeTagFromDeck(db, deckId, op.tag);
}

function replayNoteEdit(
  db: Database,
  op: Extract<EditOp, { type: 'note_edit' }>,
): void {
  try {
    const rows = db.exec('SELECT updated_at FROM notes WHERE id = ?', [op.noteId]);
    if (!rows.length || !rows[0].values.length) return;
    const currentUpdatedAt = Number(rows[0].values[0][0]);

    if (op.updatedAt > currentUpdatedAt) {
      db.run(
        'UPDATE notes SET fields = ?, updated_at = ? WHERE id = ?',
        [JSON.stringify(op.fields), op.updatedAt, op.noteId],
      );
    }
  } catch (e) {
    console.warn('[replay] note_edit failed:', e);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Set card state only if the incoming state has a more recent lastReview.
 * This implements last-writer-wins for review conflicts.
 *
 * @param db    - sql.js Database instance.
 * @param state - The incoming CardState.
 */
function setCardStateIfNewer(db: Database, state: CardState): void {
  try {
    const rows = db.exec(
      'SELECT last_review FROM card_states WHERE card_id = ?',
      [state.cardId],
    );

    if (rows.length && rows[0].values.length) {
      const currentLastReview = Number(rows[0].values[0][0]) || 0;
      const incomingLastReview = state.lastReview ?? 0;
      if (incomingLastReview < currentLastReview) return;
    }

    setCardState(db, state);
  } catch {
    // Card state row may not exist yet — insert it
    setCardState(db, state);
  }
}
