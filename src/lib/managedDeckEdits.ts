import type { Database } from 'sql.js';
import type { Result, Deck } from '../types';
import type { PersistManagedDeckEdit } from '../types/manageDeck';
import { getDeckById, getDeckSettings, renameDeck, saveDeckSettingsDraft, type DeckSettings } from './db/queries';

/** Save a name and restore the previous local name if its edit record fails.
 * @param db - Active database.
 * @param deckId - Target deck.
 * @param draft - New deck name.
 * @param persist - Optional durable edit writer.
 * @returns Updated deck or an error, retaining the original on failure.
 */
export async function commitManagedDeckName(db: Database, deckId: string, draft: string, persist?: PersistManagedDeckEdit): Promise<Result<Deck>> {
  const name = draft.trim();
  const previous = getDeckById(db, deckId);
  if (!previous.success || !previous.data) return { success:false, error:'Couldn’t open this deck.' };
  if (!name) return { success:false, error:'Give this deck a name.' };
  if (name === previous.data.name) return { success:true, data:previous.data };
  const updated = renameDeck(db, deckId, name, Math.floor(Date.now()/1000));
  if (!updated.success) return updated;
  try {
    if (persist && !await persist([{ type:'deck_rename', name }])) throw new Error('Couldn’t save the new name. Try again.');
    return updated;
  } catch (failure) {
    const restored = renameDeck(db, deckId, previous.data.name, previous.data.updatedAt);
    return { success:false, error:!restored.success ? 'Couldn’t restore the previous name. Keep this deck open and try saving again.' : failure instanceof Error ? failure.message : 'Couldn’t save the new name. Try again.' };
  }
}

/** Commit one settings draft without letting a failed Save leak into later sessions.
 * @param db - Active deck database.
 * @param draft - Complete settings draft.
 * @param persist - Optional durable edit writer.
 * @returns Success or an error after restoring the original settings.
 */
export async function commitManagedDeckSettings(db: Database, draft: DeckSettings, persist?: PersistManagedDeckEdit): Promise<Result<void>> {
  const previous = getDeckSettings(db, draft.deckId);
  if (!previous.success) return previous;
  const updated = saveDeckSettingsDraft(db, draft);
  if (!updated.success) return updated;
  try {
    if (persist && !await persist([{ type:'deck_settings', settings:draft }])) throw new Error('Couldn’t save these settings. Try again.');
    return updated;
  } catch (failure) {
    const restored = saveDeckSettingsDraft(db, previous.data);
    return { success:false, error:!restored.success ? 'Couldn’t restore the previous settings. Keep this deck open and try saving again.' : failure instanceof Error ? failure.message : 'Couldn’t save these settings. Try again.' };
  }
}
