import { commitManagedDeckName } from '../lib/managedDeckEdits';
import { useCallback, useRef, useState } from 'react';
import type { ManageDeckActionsProps } from '../types/manageDeck';
import { deleteDeck } from '../lib/db/queries';
import { persistAndBackup } from './useDatabase';
import { deleteMediaForDeck } from '../lib/platform/mediaFiles';
import { pickImageFile } from '../lib/platform/filePicker';
import { hapticTap } from '../lib/platform/haptics';
import { useDeckThumbnails } from './useDeckThumbnails';
import { useExport } from './useExport';
import { useMediaRepair } from './useMediaRepair';
import { getLibraryNotice } from '../lib/libraryNotice';

/** Execute all deck-level changes from the management workspace.
 * @param options - Current deck, storage manager and navigation outcomes.
 * @returns Guarded deck actions, one notice, cover state and visible failures.
 */
export function useManageDeck({ db, deckId, deckName, manager, onRenamed, onDeleted }: ManageDeckActionsProps) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const { setThumbnail } = useDeckThumbnails([deckId]);
  const exporter = useExport(manager ?? db);
  const media = useMediaRepair(db, manager);
  const run = useCallback(async (work: () => Promise<void>) => {
    if (lock.current) return false;
    lock.current = true; setBusy(true); setError('');
    try { await work(); void hapticTap(); return true; }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Couldn’t save. Your other changes are still here.'); return false; }
    finally { lock.current = false; setBusy(false); }
  }, []);
  const rename = useCallback(async (draft: string) => run(async () => {
    if (!db) throw new Error('This deck isn’t ready yet.');
    const name = draft.trim();
    const saved = await commitManagedDeckName(db, deckId, name, manager ? ops => manager.writeEdit(deckId, ops) : undefined);
    if (!saved.success) throw new Error(saved.error);
    if (manager) {
      manager.refreshCounts(deckId);
      await manager.compact(deckId);
      await manager.refreshDecks();
    } else persistAndBackup();
    onRenamed(name);
  }), [run, db, manager, deckId, onRenamed]);
  const remove = useCallback(async () => run(async () => {
    if (manager) await manager.removeDeck(deckId);
    else {
      if (!db) throw new Error('This deck isn’t ready yet.');
      const removed = deleteDeck(db, deckId);
      if (!removed.success) throw new Error(removed.error);
      persistAndBackup();
    }
    // Library removal has committed. Media cleanup must not strand a closed DB on screen.
    try { await deleteMediaForDeck(deckId); } catch { /* Orphan eviction retries on launch. */ }
    onDeleted();
  }), [run, manager, db, deckId, onDeleted]);
  const pickCover = useCallback(async () => { await run(async () => { const file = await pickImageFile(); if (file) setCropFile(file); }); }, [run]);
  const saveCover = useCallback(async (base64: string) => { await run(async () => { await setThumbnail(deckId, base64); setCropFile(null); }); }, [run, setThumbnail, deckId]);
  const notice = getLibraryNotice({ libraryError:'', importNotice:null, exportPhase:exporter.phase, exportError:exporter.errorMessage, mediaPhase:media.phase, mediaMessage:media.message });
  const dismissNotice = () => { exporter.reset(); media.dismiss(); };
  return { error, busy:busy || media.busy || exporter.phase === 'exporting', rename, remove, cropFile, pickCover, saveCover, cancelCrop:() => setCropFile(null),
    restore:() => media.restore(deckId), exportFresh:() => exporter.exportDeckFresh(deckId, deckName), exportProgress:() => exporter.exportDeckWithProgress(deckId, deckName), notice, dismissNotice };
}
