import { useCallback, useEffect, useRef, useState } from 'react';
import { copyCardMedia, pasteCardMedia, saveCardMedia } from '../lib/platform/cardMedia';
import type { CardFace } from '../types/editorUi';
import type { CardMediaKind, SavedCardMedia } from '../types/cardMedia';
import type { EditorMediaOptions } from '../types/editorMedia';
import { hapticTap } from '../lib/platform/haptics';
import { bundledCardMediaFilename } from '../lib/cardClipboard';

/** Keep explicit editor clipboard operations durable and independent of study gestures.
 * @param options - Destination side refs, portable media mapping and error/cache callbacks.
 * @returns Busy guard, selected-file/paste/copy actions and portable HTML restoration.
 */
export function useCardEditorMedia(options: EditorMediaOptions) {
  const latest = useRef(options);
  latest.current = options;
  const mounted = useRef(true);
  const busyRef = useRef(false);
  const inserted = useRef(new Map<string, string>());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const begin = useCallback(() => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    latest.current.onError('');
    return true;
  }, []);
  const finish = useCallback(() => {
    busyRef.current = false;
    if (mounted.current) setBusy(false);
  }, []);
  const insert = useCallback((side: CardFace, item: SavedCardMedia) => {
    if (!mounted.current) return;
    const current = latest.current;
    inserted.current.set(item.url, item.filename);
    current.onMediaAdded?.(item.filename, item.url);
    (side === 'front' ? current.frontRef : current.backRef).current?.insertMedia(item.url, item.kind);
  }, []);
  const addFiles = useCallback(async (side: CardFace, files: File[]) => {
    if (!files.length || !begin()) return;
    try {
      for (const file of files) {
        const result = await saveCardMedia(latest.current.deckId, file);
        if (!mounted.current) return;
        if (!result.success) { latest.current.onError(result.error); break; }
        insert(side, result.data);
      }
    } catch {
      if (mounted.current) latest.current.onError('Couldn’t add that media. Your other changes are still here.');
    } finally { finish(); }
  }, [begin, finish, insert]);
  const paste = useCallback(async (side: CardFace) => {
    if (!begin()) return;
    try {
      const result = await pasteCardMedia(latest.current.deckId);
      if (!mounted.current) return;
      if (!result.success) { latest.current.onError(result.error); return; }
      for (const item of result.data) insert(side, item);
    } catch {
      if (mounted.current) latest.current.onError('Couldn’t paste that media. Try Add media instead.');
    } finally { finish(); }
  }, [begin, finish, insert]);
  const copy = useCallback(async (url: string, kind: CardMediaKind) => {
    if (!begin()) return;
    try {
      const current = latest.current;
      const filename = inserted.current.get(url) ?? current.reverseMap.get(url)
        ?? (!url.includes('/') && !url.includes(':') ? url : bundledCardMediaFilename(current.deckId, url));
      if (!filename) {
        current.onError('This media isn’t saved on this device. Add a local copy first.');
        return;
      }
      const result = await copyCardMedia(current.deckId, filename, url, kind);
      if (!mounted.current) return;
      if (!result.success) current.onError(result.error);
      else void hapticTap();
    } catch {
      if (mounted.current) latest.current.onError('Couldn’t copy that media. Your card hasn’t changed.');
    } finally { finish(); }
  }, [begin, finish]);
  const restoreReferences = useCallback((html: string) => {
    let portable = html;
    for (const [url, filename] of new Map([...latest.current.reverseMap, ...inserted.current])) {
      portable = portable.split(url).join(filename);
    }
    return portable;
  }, []);
  return { busy, busyRef, addFiles, paste, copy, restoreReferences };
}
