import type { Result } from '../../types';
import type { SavedCardImage } from '../../types/cardImages';
import { saveMediaFile, getMediaFileWebUrl } from './mediaFiles';

/** Store a picked photo outside the deck database and resolve its display URL.
 * @param deckId - The deck receiving this attachment.
 * @param file - The image selected by the user.
 * @returns A portable filename and preview URL, or an actionable failure.
 */
export async function saveCardImage(deckId: string, file: File): Promise<Result<SavedCardImage>> {
  try {
    const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (!file.size || (!file.type.startsWith('image/') && !/^(png|jpe?g|gif|webp|svg|heic|heif|avif)$/.test(extension))) {
      return { success: false, error: 'Choose a photo or image file.' };
    }
    const safeExtension = /^[a-z0-9]{1,8}$/.test(extension) ? extension : 'jpg';
    const filename = `user_${crypto.randomUUID()}.${safeExtension}`;
    await saveMediaFile(deckId, filename, new Uint8Array(await file.arrayBuffer()));
    const url = await getMediaFileWebUrl(deckId, filename);
    if (!url) return { success: false, error: 'Couldn’t open that photo. Please try again.' };
    return { success: true, data: { filename, url } };
  } catch {
    return { success: false, error: 'Couldn’t save that photo. Check your device’s storage and try again.' };
  }
}
