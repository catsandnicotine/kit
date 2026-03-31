/**
 * useCardEditor — business logic for the card editor overlay.
 *
 * Responsibilities:
 *  - Manage draft state for tags.
 *  - Track dirty state (tags changed, or content edited flag).
 *  - Save edits: update the card row and persist.
 *  - Delete a card with confirmation.
 */

import { useCallback, useEffect, useState } from 'react';
import type { Database } from 'sql.js';
import type { Card, Result } from '../types';
import type { EditOp } from '../lib/sync/types';
import { deleteCard, insertCard, updateCard, addTagToDeck } from '../lib/db/queries';
import { persistDatabase } from './useDatabase';
import { scheduleICloudBackup } from './useBackup';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface UseCardEditorReturn {
  /** The card being edited (original values). */
  card: Card;
  /** Draft tags array. */
  tags: string[];
  /** Whether there are unsaved changes. */
  dirty: boolean;
  /** Signal that content has been edited (called by contenteditable onInput). */
  markContentDirty: () => void;
  /** Add a tag to the draft. */
  addTag: (tag: string) => void;
  /** Remove a tag by index. */
  removeTag: (index: number) => void;
  /**
   * Save changes to the database.
   * Accepts the current front/back HTML from the contenteditable divs.
   *
   * @param front - Current front innerHTML.
   * @param back  - Current back innerHTML.
   * @returns The updated Card on success, or an error.
   */
  save: (front: string, back: string) => Result<Card>;
  /** Delete the card from the database. */
  remove: () => Result<void>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Drive the card editor state for a single card.
 *
 * @param db         - sql.js Database instance (null while loading).
 * @param card       - The card being edited (or blank card for creation).
 * @param isNew      - If true, save inserts a new card instead of updating.
 * @param onSyncEdit - Optional callback to emit sync edit operations (new arch).
 * @returns Draft state and action callbacks for the editor UI.
 */
export function useCardEditor(
  db: Database | null,
  card: Card,
  isNew = false,
  onSyncEdit?: (ops: EditOp[]) => void,
): UseCardEditorReturn {
  const [tags, setTags] = useState<string[]>(card.tags);
  const [contentDirty, setContentDirty] = useState(false);

  // Reset draft when a different card is opened.
  // Serialize tags for stable dependency comparison (arrays differ by reference).
  const tagsKey = JSON.stringify(card.tags);
  useEffect(() => {
    setTags(card.tags);
    setContentDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id, tagsKey]);

  const tagsDirty = JSON.stringify(tags) !== JSON.stringify(card.tags);
  const dirty = contentDirty || tagsDirty;

  const markContentDirty = useCallback(() => {
    setContentDirty(true);
  }, []);

  const addTag = useCallback((tag: string) => {
    const trimmed = tag.trim();
    if (trimmed === '') return;
    setTags(prev => (prev.includes(trimmed) ? prev : [...prev, trimmed]));
  }, []);

  const removeTag = useCallback((index: number) => {
    setTags(prev => prev.filter((_, i) => i !== index));
  }, []);

  const save = useCallback(
    (front: string, back: string): Result<Card> => {
      if (!db) return { success: false, error: 'Database not ready.' };

      const now = Math.floor(Date.now() / 1000);

      if (isNew) {
        const newCard: Card = {
          ...card,
          front,
          back,
          tags,
          createdAt: now,
          updatedAt: now,
        };
        const insertResult = insertCard(db, newCard);
        if (!insertResult.success) return insertResult;

        // Sync new tags to deck_tags so pills stay visible
        for (const t of tags) {
          addTagToDeck(db, card.deckId, t, now);
        }
        if (onSyncEdit) {
          onSyncEdit([{ type: 'card_add', card: newCard }]);
        } else {
          persistDatabase();
          scheduleICloudBackup();
        }
        return { success: true, data: newCard };
      }

      const result = updateCard(db, card.id, front, back, tags, now);
      if (result.success) {
        // Sync new tags to deck_tags so pills stay visible
        const newTags = tags.filter(t => !card.tags.includes(t));
        for (const t of newTags) {
          addTagToDeck(db, card.deckId, t, now);
        }
        if (onSyncEdit) {
          onSyncEdit([{
            type: 'card_edit',
            cardId: card.id,
            fields: { front, back, tags },
            updatedAt: now,
          }]);
        } else {
          persistDatabase();
          scheduleICloudBackup();
        }
      }
      return result;
    },
    [db, card, tags, isNew, onSyncEdit],
  );

  const remove = useCallback((): Result<void> => {
    if (!db) return { success: false, error: 'Database not ready.' };

    const result = deleteCard(db, card.id);
    if (result.success) {
      if (onSyncEdit) {
        onSyncEdit([{ type: 'card_delete', cardId: card.id }]);
      } else {
        persistDatabase();
        scheduleICloudBackup();
      }
    }
    return result;
  }, [db, card.id, onSyncEdit]);

  return {
    card,
    tags,
    dirty,
    markContentDirty,
    addTag,
    removeTag,
    save,
    remove,
  };
}
