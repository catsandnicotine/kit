import type { DeckMediaBootstrap } from '../../types/deckMedia';
import { getMediaDirUri, listMediaFilenames } from './mediaFiles';
import { isNativePlatform } from './platformDetect';

/** Prepare native URL metadata alongside navigation without opening image/audio bytes.
 * @param deckId - The one deck whose screen will consume this handoff.
 * @returns Frozen native metadata, or null in a browser; unexpected IO failures propagate.
 */
export async function prepareDeckMediaBootstrap(deckId: string): Promise<DeckMediaBootstrap | null> {
  if (!isNativePlatform()) return null;
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(deckId)) throw new Error('Could not identify this deck’s media.');
  try {
    const [filenames, dirUri] = await Promise.all([listMediaFilenames(deckId), getMediaDirUri(deckId)]);
    return Object.freeze({ deckId, filenames:Object.freeze([...filenames]), dirUri });
  } catch (error) {
    throw new Error('Could not prepare this deck’s media.', { cause:error });
  }
}
