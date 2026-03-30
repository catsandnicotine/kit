/**
 * useTagSheet — business logic for the TagBottomSheet.
 *
 * Encapsulates all mutations that can happen to a tag from the bottom sheet:
 * rename, change color, delete, add/remove from decks.
 */

import { useCallback, useEffect, useState } from 'react';
import type { Database } from 'sql.js';
import type { Deck } from '../types';
import {
  renameTagInCards,
  deleteTagFromCards,
  upsertTagColor,
  addTagToDeck,
  removeTagFromDeck,
  getDecksByTag,
  getAllDecks,
} from '../lib/db/queries';
import { hapticAgain, hapticSuccess, hapticTap } from '../lib/platform/haptics';
import { persistAndBackup } from './useDatabase';
import type { EditOp } from '../lib/sync/types';

export interface DeckAssociation {
  deckId: string;
  deckName: string;
}

export interface UseTagSheetReturn {
  /** All decks, for the "Add to Deck" picker. */
  allDecks: Deck[];
  /** Decks this tag is currently associated with. */
  deckAssociations: DeckAssociation[];
  /** Whether associations are being loaded. */
  loadingAssociations: boolean;
  renameTag: (oldTag: string, newTag: string) => boolean;
  changeColor: (tag: string, hex: string) => void;
  deleteTag: (tag: string) => void;
  addToDeck: (tag: string, deckId: string) => void;
  removeFromDeck: (tag: string, deckId: string) => void;
  reloadAssociations: (tag: string) => void;
}

/**
 * Provides business logic for tag mutations from the bottom sheet.
 *
 * @param db            - sql.js Database instance (may be null before init).
 * @param onMutated     - Callback fired after any mutation that changes the tag list.
 * @param onColorChange - Optimistic callback for color changes.
 * @param onSyncEdit    - Optional callback to emit sync edit operations (new arch).
 */
export function useTagSheet(
  db: Database | null,
  onMutated: () => void,
  onColorChange: (tag: string, hex: string) => void,
  onSyncEdit?: (ops: EditOp[]) => void,
): UseTagSheetReturn {
  const [allDecks, setAllDecks] = useState<Deck[]>([]);
  const [deckAssociations, setDeckAssociations] = useState<DeckAssociation[]>([]);
  const [loadingAssociations, setLoadingAssociations] = useState(false);

  useEffect(() => {
    if (!db) return;
    const result = getAllDecks(db);
    if (result.success) setAllDecks(result.data);
  }, [db]);

  const reloadAssociations = useCallback((tag: string) => {
    if (!db) return;
    setLoadingAssociations(true);
    const result = getDecksByTag(db, tag);
    setDeckAssociations(result.success ? result.data : []);
    setLoadingAssociations(false);
  }, [db]);

  /** Persist via sync edit or old path. */
  const persist = useCallback((ops: EditOp[]) => {
    if (onSyncEdit) {
      onSyncEdit(ops);
    } else {
      persistAndBackup();
    }
  }, [onSyncEdit]);

  const renameTag = useCallback((oldTag: string, newTag: string): boolean => {
    if (!db) return false;
    const now = Math.floor(Date.now() / 1000);
    const result = renameTagInCards(db, oldTag, newTag, now);
    if (result.success) {
      persist([{ type: 'tag_rename', oldTag, newTag }]);
      hapticSuccess();
      onMutated();
    }
    return result.success;
  }, [db, onMutated, persist]);

  const changeColor = useCallback((tag: string, hex: string) => {
    if (!db) return;
    const now = Math.floor(Date.now() / 1000);
    const result = upsertTagColor(db, tag, hex, now);
    if (result.success) {
      persist([{ type: 'tag_add', tag, color: hex }]);
      hapticTap();
      onColorChange(tag, hex);
    }
  }, [db, onColorChange, persist]);

  const deleteTag = useCallback((tag: string) => {
    if (!db) return;
    const now = Math.floor(Date.now() / 1000);
    const result = deleteTagFromCards(db, tag, now);
    if (result.success) {
      persist([{ type: 'tag_delete', tag }]);
      hapticAgain();
      onMutated();
    }
  }, [db, onMutated, persist]);

  const addToDeck = useCallback((tag: string, deckId: string) => {
    if (!db) return;
    const now = Math.floor(Date.now() / 1000);
    const result = addTagToDeck(db, deckId, tag, now);
    if (result.success) {
      persist([{ type: 'deck_tag_add', tag }]);
      hapticTap();
      setDeckAssociations(prev => {
        if (prev.some(a => a.deckId === deckId)) return prev;
        const deck = allDecks.find(d => d.id === deckId);
        if (!deck) return prev;
        return [...prev, { deckId, deckName: deck.name }];
      });
    }
  }, [db, allDecks, persist]);

  const removeFromDeck = useCallback((tag: string, deckId: string) => {
    if (!db) return;
    const result = removeTagFromDeck(db, deckId, tag);
    if (result.success) {
      persist([{ type: 'deck_tag_remove', tag }]);
      hapticTap();
      setDeckAssociations(prev => prev.filter(a => a.deckId !== deckId));
    }
  }, [db, persist]);

  return {
    allDecks,
    deckAssociations,
    loadingAssociations,
    renameTag,
    changeColor,
    deleteTag,
    addToDeck,
    removeFromDeck,
    reloadAssociations,
  };
}
