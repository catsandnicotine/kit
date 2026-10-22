import { useCallback, useRef, useState } from 'react';
import type { Database } from 'sql.js';
import { pickApkgFile } from '../lib/platform/filePicker';
import { saveMediaFile } from '../lib/platform/mediaFiles';
import { parseApkgLazy, extractMediaBatch } from '../lib/apkg';
import { getCardsByDeck } from '../lib/db/queries';
import { getMediaReferences } from '../lib/media';
import { hapticSuccess, hapticTap } from '../lib/platform/haptics';
import type { UseDeckManagerReturn } from './useDeckManager';
import type { LibraryOperationPhase } from '../types/libraryNotice';

/** Restore media from an original Anki package, keeping all study data.
 * @param db - Legacy database, if used.
 * @param manager - Per-deck database manager, if used.
 * @returns A guarded file-picker action and a dismissible result/status message.
 */
export function useMediaRepair(db: Database | null, manager?: UseDeckManagerReturn) {
  const [message, setMessage] = useState<string | null>(null);
  const [phase, setPhase] = useState<LibraryOperationPhase>('idle');
  const locked = useRef(false);
  const restore = useCallback(async (deckId: string) => {
    if (locked.current) return;
    locked.current = true;
    try {
      void hapticTap();
      const file = await pickApkgFile();
      if (!file) return;
      setPhase('working');
      setMessage('Restoring pictures and audio…');
      const target = manager ? manager.getCachedDeckDb(deckId) ?? await manager.openDeckDb(deckId) : db;
      if (!target) throw new Error('Could not open this deck.');
      const cards = getCardsByDeck(target, deckId);
      if (!cards.success) throw new Error(cards.error);
      const references = getMediaReferences(cards.data.map(card => card.front + card.back).join('\n'));
      const parsed = await parseApkgLazy(await file.arrayBuffer());
      if (!parsed.success) throw new Error(parsed.error);
      const matching = parsed.data.mediaManifest.filter(entry => references.has(entry.filename));
      if (!matching.length) throw new Error('This file has no matching pictures or audio for this deck. Choose its original Anki file.');
      let count = 0;
      for (let index = 0; index < matching.length; index += 20) {
        const files = await extractMediaBatch(parsed.data.zip, matching, index, 20, parsed.data.mediaIsCompressed);
        for (const media of files) { await saveMediaFile(deckId, media.filename, media.data); count++; }
      }
      if (count !== matching.length) throw new Error(`Restored ${count} of ${matching.length} files. Some files in this package could not be read.`);
      setMessage(`Restored ${count} media files. Your cards and study progress are unchanged.`);
      setPhase('done');
      void hapticSuccess();
    } catch (error) { setPhase('error'); setMessage(error instanceof Error ? error.message : 'Could not restore this deck’s media.'); }
    finally { locked.current = false; }
  }, [db, manager]);
  return { restore, message, busy: phase === 'working', phase, dismiss: () => { setMessage(null); setPhase('idle'); } };
}
