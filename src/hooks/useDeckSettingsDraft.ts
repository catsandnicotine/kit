import { commitManagedDeckSettings } from '../lib/managedDeckEdits';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Database } from 'sql.js';
import type { UseDeckManagerReturn } from './useDeckManager';
import { getDeckSettings, type DeckSettings } from '../lib/db/queries';
import { persistAndBackup } from './useDatabase';
import { hapticTap } from '../lib/platform/haptics';

/** Keep scheduling changes as a draft until the explicit Save action.
 * @param db - Active deck database.
 * @param deckId - Target deck.
 * @param manager - Optional per-deck durable storage/sync manager.
 * @returns Original/draft settings, guarded save, and a visible failure message.
 */
export function useDeckSettingsDraft(db: Database | null, deckId: string, manager?: UseDeckManagerReturn) {
  const [original, setOriginal] = useState<DeckSettings | null>(null);
  const [draft, setDraft] = useState<DeckSettings | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  useEffect(() => {
    if (!db) return;
    const result = getDeckSettings(db, deckId);
    if (result.success) { setOriginal(result.data); setDraft(result.data); }
    else setError('Couldn’t load these settings. Go back and try again.');
  }, [db, deckId]);
  const change = useCallback((partial: Partial<DeckSettings>) => setDraft(previous => previous ? { ...previous, ...partial } : previous), []);
  const save = useCallback(async () => {
    if (!db || !draft || lock.current) return false;
    lock.current = true; setBusy(true); setError('');
    try {
      const saved = await commitManagedDeckSettings(db, draft, manager ? ops => manager.writeEdit(deckId, ops) : undefined);
      if (!saved.success) throw new Error(saved.error);
      if (manager) await manager.compact(deckId); else persistAndBackup();
      setOriginal(draft);
      void hapticTap();
      return true;
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Couldn’t save these settings. Try again.'); return false; }
    finally { lock.current = false; setBusy(false); }
  }, [db, draft, deckId, manager]);
  return { original, draft, change, save, error, busy, dirty:JSON.stringify(original) !== JSON.stringify(draft) };
}
