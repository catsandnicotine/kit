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
import { deleteCard, updateCard } from '../lib/db/queries';
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
 * @param db   - sql.js Database instance (null while loading).
 * @param card - The card being edited.
 * @returns Draft state and action callbacks for the editor UI.
 */
export function useCardEditor(
  db: Database | null,
  card: Card,
): UseCardEditorReturn {
  const [tags, setTags] = useState<string[]>(card.tags);
  const [contentDirty, setContentDirty] = useState(false);

  // Reset draft when a different card is opened.
  useEffect(() => {
    setTags(card.tags);
    setContentDirty(false);
  }, [card.id, card.tags]);

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
      const result = updateCard(db, card.id, front, back, tags, now);
      if (result.success) {
        persistDatabase();
        scheduleICloudBackup();
      }
      return result;
    },
    [db, card.id, tags],
  );

  const remove = useCallback((): Result<void> => {
    if (!db) return { success: false, error: 'Database not ready.' };

    const result = deleteCard(db, card.id);
    if (result.success) {
      persistDatabase();
      scheduleICloudBackup();
    }
    return result;
  }, [db, card.id]);

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
