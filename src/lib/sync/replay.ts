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
  insertReplayCard,
  updateCard,
  deleteCard,
  setCardState,
  setCardSuspended,
  insertReplayReview,
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
import type { CardState, Result } from '../../types';
import { parseHLC } from './hlc';

function must<T>(result: Result<T>): T {
  if (!result.success) throw new Error(result.error);
  return result.data;
}

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
  const nextDeleted = new Set(deletedCardIds);

  try {
    for (const edit of edits) {
      for (const op of edit.ops) {
        replayOp(db, op, edit.deckId, nextDeleted, Math.floor((parseHLC(edit.hlc)?.wallMs ?? 0) / 1000));
      }
      lastHLC = edit.hlc;
    }

    const commit = commitTransaction(db);
    if (!commit.success) {
      console.warn('[replay] Failed to commit transaction:', commit.error);
      rollbackTransaction(db);
      return null;
    }

    deletedCardIds.clear();
    nextDeleted.forEach(id => deletedCardIds.add(id));
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
  at: number,
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
      replayDeckRename(db, op, deckId, at);
      break;
    case 'deck_settings':
      replayDeckSettings(db, op, deckId);
      break;
    case 'tag_add':
      replayTagAdd(db, op, at);
      break;
    case 'tag_rename':
      replayTagRename(db, op, deckId, at);
      break;
    case 'tag_delete':
      replayTagDelete(db, op, deckId, at);
      break;
    case 'deck_tag_add':
      replayDeckTagAdd(db, op, deckId, at);
      break;
    case 'deck_tag_remove':
      replayDeckTagRemove(db, op, deckId);
      break;
    case 'note_edit':
      replayNoteEdit(db, op);
      break;
    default: throw new Error('Unknown sync operation');
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

  must(insertReplayReview(db, {
    id:op.logId, cardId:op.cardId, rating:op.rating, reviewedAt:op.reviewedAt,
    elapsed:op.elapsed, scheduledDays:op.scheduledDays,
  }));

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

  if (!must(insertReplayCard(db, op.card))) return;
  if (op.state) must(setCardState(db, op.state));
}

function replayCardEdit(
  db: Database,
  op: Extract<EditOp, { type: 'card_edit' }>,
  deletedCardIds: Set<string>,
): void {
  if (deletedCardIds.has(op.cardId)) return;

    const rows = db.exec(
      'SELECT updated_at, front, back, tags FROM cards WHERE id = ?',
      [op.cardId],
    );
    if (!rows.length || !rows[0]!.values.length) return;
    const row = rows[0]!.values[0]!;
    const currentUpdatedAt = Number(row[0]);

    if (op.updatedAt >= currentUpdatedAt) {
      const front = op.fields.front;
      const back = op.fields.back;
      const tags = op.fields.tags;

      // Only update fields present in the op — preserve current values for the rest
      if (front !== undefined || back !== undefined || tags !== undefined) {
        const curFront = String(row[1] ?? '');
        const curBack = String(row[2] ?? '');
        let curTags: string[] = [];
        if (row[3]) {
          try { curTags = JSON.parse(String(row[3])); } catch { /* keep empty */ }
        }

        must(updateCard(
          db,
          op.cardId,
          front ?? curFront,
          back ?? curBack,
          tags ?? curTags,
          op.updatedAt,
        ));
      }
    }
}

function replayCardDelete(
  db: Database,
  op: Extract<EditOp, { type: 'card_delete' }>,
  deletedCardIds: Set<string>,
): void {
  must(deleteCard(db, op.cardId));
  deletedCardIds.add(op.cardId);
}

function replayCardSuspend(
  db: Database,
  op: Extract<EditOp, { type: 'card_suspend' }>,
  deletedCardIds: Set<string>,
): void {
  if (deletedCardIds.has(op.cardId)) return;
  must(setCardSuspended(db, op.cardId, op.suspended));
}

function replayDeckRename(
  db: Database,
  op: Extract<EditOp, { type: 'deck_rename' }>,
  deckId: string,
  at: number,
): void {
  must(renameDeck(db, deckId, op.name, at));
}

function replayDeckSettings(
  db: Database,
  op: Extract<EditOp, { type: 'deck_settings' }>,
  deckId: string,
): void {
  const s = op.settings;

  // Upsert each setting that is present
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
}

function replayTagAdd(
  db: Database,
  op: Extract<EditOp, { type: 'tag_add' }>,
  at: number,
): void {
  const now = at;
  const result = upsertTagColor(db, op.tag, op.color ?? '', now);
  if (!result.success) throw new Error(result.error);
}

function replayTagRename(
  db: Database,
  op: Extract<EditOp, { type: 'tag_rename' }>,
  deckId: string,
  at: number,
): void {
  const now = at;
  const result = renameTagInCards(db, op.oldTag, op.newTag, now, deckId);
  if (!result.success) throw new Error(result.error);
}

function replayTagDelete(
  db: Database,
  op: Extract<EditOp, { type: 'tag_delete' }>,
  deckId: string,
  at: number,
): void {
  const now = at;
  const result = deleteTagFromCards(db, op.tag, now, deckId);
  if (!result.success) throw new Error(result.error);
}

function replayDeckTagAdd(
  db: Database,
  op: Extract<EditOp, { type: 'deck_tag_add' }>,
  deckId: string,
  at: number,
): void {
  const now = at;
  must(addTagToDeck(db, deckId, op.tag, now));
}

function replayDeckTagRemove(
  db: Database,
  op: Extract<EditOp, { type: 'deck_tag_remove' }>,
  deckId: string,
): void {
  must(removeTagFromDeck(db, deckId, op.tag));
}

function replayNoteEdit(
  db: Database,
  op: Extract<EditOp, { type: 'note_edit' }>,
): void {
    const rows = db.exec('SELECT updated_at FROM notes WHERE id = ?', [op.noteId]);
    if (!rows.length || !rows[0]!.values.length) return;
    const currentUpdatedAt = Number(rows[0]!.values[0]![0]);

    if (op.updatedAt >= currentUpdatedAt) {
      db.run(
        'UPDATE notes SET fields = ?, updated_at = ? WHERE id = ?',
        [JSON.stringify(op.fields), op.updatedAt, op.noteId],
      );
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
  const rows = db.exec('SELECT last_review FROM card_states WHERE card_id = ?', [state.cardId]);
  if (rows.length && rows[0]!.values.length) {
    const currentLastReview = Number(rows[0]!.values[0]![0]) || 0;
    if ((state.lastReview ?? 0) < currentLastReview) return;
  }
  must(setCardState(db, state));
}
