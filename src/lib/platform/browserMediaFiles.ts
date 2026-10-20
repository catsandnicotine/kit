import type { MediaDirectoryHandle } from '../../types/mediaStorage';

async function directory(deckId: string, create = false): Promise<MediaDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  const media = await root.getDirectoryHandle('kit-media', { create });
  return await media.getDirectoryHandle(encodeURIComponent(deckId), { create }) as MediaDirectoryHandle;
}

/** Persist media outside temporary/snapshot databases.
 * @param deckId - Owner deck.
 * @param filename - Original Anki media filename.
 * @param data - Original bytes.
 * @returns Resolves only after the file is durably closed; storage errors propagate.
 */
export async function saveBrowserMedia(deckId: string, filename: string, data: Uint8Array): Promise<void> {
  const dir = await directory(deckId, true);
  const file = await dir.getFileHandle(encodeURIComponent(filename), { create:true });
  const writer = await file.createWritable();
  try { await writer.write(new Blob([new Uint8Array(data)])); await writer.close(); }
  catch (error) { await writer.abort().catch(() => {}); throw error; }
}

/** Read a file-backed Blob without loading the whole deck's bytes into memory.
 * @param deckId - Owner deck.
 * @param filename - Original filename.
 * @returns A file-backed Blob, or null when not present.
 */
export async function readBrowserMedia(deckId: string, filename: string): Promise<File | null> {
  try { return await (await (await directory(deckId)).getFileHandle(encodeURIComponent(filename))).getFile(); }
  catch { return null; }
}

/** List original media filenames.
 * @param deckId - Owner deck.
 * @returns Original filenames, with an empty list for decks without stored media.
 */
export async function listBrowserMedia(deckId: string): Promise<string[]> {
  try {
    const files: string[] = [];
    for await (const [name, handle] of (await directory(deckId)).entries()) {
      if (handle.kind === 'file') files.push(decodeURIComponent(name));
    }
    return files;
  } catch { return []; }
}

/** Remove only this deck's local files after deleting the deck.
 * @param deckId - Owner deck.
 * @returns Removal completion.
 */
export async function deleteBrowserMedia(deckId: string): Promise<void> {
  try {
    const root = await navigator.storage.getDirectory();
    const media = await root.getDirectoryHandle('kit-media');
    await media.removeEntry(encodeURIComponent(deckId), { recursive:true });
  } catch { /* A deck without media has nothing to remove. */ }
}
