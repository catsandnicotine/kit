import { Capacitor, registerPlugin } from '@capacitor/core';
import type { Result } from '../../types';
import type { CardMediaFileFormat, CardMediaKind, MediaClipboardPlugin, SavedCardMedia } from '../../types/cardMedia';
import { getMediaFileWebUrl, saveMediaBlobFile } from './mediaFiles';

const clipboard = registerPlugin<MediaClipboardPlugin>('MediaClipboard');
const EXTENSIONS: Readonly<Record<string, string>> = {
  'image/png':'png', 'image/jpeg':'jpg', 'image/gif':'gif', 'image/webp':'webp',
  'image/svg+xml':'svg', 'image/heic':'heic', 'image/heif':'heif', 'image/avif':'avif',
  'image/bmp':'bmp', 'image/tiff':'tiff',
  'video/mp4':'mp4', 'video/quicktime':'mov', 'video/x-m4v':'m4v', 'video/webm':'webm', 'video/ogg':'ogv',
};
const IMAGE_EXTENSIONS = /^(png|jpe?g|gif|webp|svg|heic|heif|avif|bmp|tiff?)$/;
const VIDEO_EXTENSIONS = /^(mp4|mov|m4v|webm|ogv)$/;
const PASTE_FALLBACK = 'The clipboard doesn’t include a photo or video Kit can use. Try Add media instead.';

function validDeckId(deckId: string): boolean {
  return /^[a-zA-Z0-9_-]{1,160}$/.test(deckId);
}

function validFilename(filename: string): boolean {
  return !!filename && filename !== '.' && filename !== '..' && filename.length <= 255 && !/[\\/]/.test(filename)
    && ![...filename].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
}

function fileFormat(file: File): CardMediaFileFormat | null {
  const mime = file.type.toLowerCase().split(';')[0]?.trim() ?? '';
  const nameExtension = file.name.split('.').pop()?.toLowerCase() ?? '';
  const mimeExtension = EXTENSIONS[mime];
  const extension = mimeExtension ?? nameExtension;
  if (IMAGE_EXTENSIONS.test(extension) && (!mime || mime === 'application/octet-stream' || mime.startsWith('image/'))) return { extension, kind:'image' };
  if (VIDEO_EXTENSIONS.test(extension) && (!mime || mime === 'application/octet-stream' || mime.startsWith('video/'))) return { extension, kind:'video' };
  return null;
}

/** Save a selected or pasted file without materialising a whole video in JS memory.
 * @param deckId - Safe single-segment owner ID, including Kit's built-in deck IDs.
 * @param file - Explicitly selected or pasted media; the original bytes are preserved.
 * @returns A portable filename and display URL, or a recoverable error.
 */
export async function saveCardMedia(deckId: string, file: File): Promise<Result<SavedCardMedia>> {
  if (!validDeckId(deckId)) return { success:false, error:'Couldn’t identify this deck. Reopen it and try again.' };
  const format = fileFormat(file);
  if (!file.size || !format) return { success:false, error:'Choose a photo or an MP4, MOV, M4V or WebM video.' };
  try {
    const filename = `user_${crypto.randomUUID()}.${format.extension}`;
    await saveMediaBlobFile(deckId, filename, file);
    const url = await getMediaFileWebUrl(deckId, filename);
    if (!url) return { success:false, error:'The file was saved, but its preview couldn’t open. Your other changes are still here.' };
    return { success:true, data:{ filename, url, kind:format.kind } };
  } catch {
    return { success:false, error:'Couldn’t save that media. Check your device’s storage and try again. Your other changes are still here.' };
  }
}

/** Read media only in response to the user's explicit Paste action.
 * @param deckId - Deck receiving independent durable copies of clipboard files.
 * @returns Accepted media in clipboard order, or an actionable failure without card edits.
 */
export async function pasteCardMedia(deckId: string): Promise<Result<SavedCardMedia[]>> {
  if (!validDeckId(deckId)) return { success:false, error:'Couldn’t identify this deck. Reopen it and try again.' };
  try {
    if (Capacitor.getPlatform() === 'ios') {
      if (!Capacitor.isPluginAvailable('MediaClipboard')) return { success:false, error:'Paste isn’t available in this build. Try Add media instead.' };
      const response = await clipboard.paste({ deckId });
      if (!response.items.length) return { success:false, error:PASTE_FALLBACK };
      const items = response.items.map(item => {
        if (!validFilename(item.filename) || !['image', 'video'].includes(item.kind) || !item.url.startsWith('file:')) throw new Error('Invalid media response');
        return { ...item, url:Capacitor.convertFileSrc(item.url) };
      });
      return { success:true, data:items };
    }
    if (!navigator.clipboard?.read) return { success:false, error:'Use your device’s Paste command in a text field, or choose Add media.' };
    const items = await navigator.clipboard.read();
    const saved: SavedCardMedia[] = [];
    for (const item of items) {
      // A clipboard item may contain several representations of one image.
      const type = item.types.find(value => value.startsWith('video/')) ?? item.types.find(value => value.startsWith('image/'));
      if (!type) continue;
      const blob = await item.getType(type);
      const extension = EXTENSIONS[type];
      if (!extension) return { success:false, error:PASTE_FALLBACK };
      const result = await saveCardMedia(deckId, new File([blob], `pasted.${extension}`, { type }));
      if (!result.success) return result;
      saved.push(result.data);
    }
    return saved.length ? { success:true, data:saved } : { success:false, error:PASTE_FALLBACK };
  } catch {
    return { success:false, error:'Couldn’t paste that media. Allow Paste if iOS asks, or try Add media. Your other changes are still here.' };
  }
}

async function pngRepresentation(displayUrl: string): Promise<Blob> {
  const response = await fetch(displayUrl);
  if (!response.ok) throw new Error('Media unavailable');
  const blob = await response.blob();
  if (blob.type === 'image/png') return blob;
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image conversion unavailable');
    context.drawImage(bitmap, 0, 0);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new Error('Image conversion failed')), 'image/png'));
  } finally { bitmap.close(); }
}

/** Copy the actual attachment, never an app-private display URL masquerading as media.
 * @param deckId - Deck owning the original file.
 * @param filename - Portable original filename; path traversal is rejected.
 * @param displayUrl - Resolved preview for browser image copying or bundled native art.
 * @param kind - Media representation to copy.
 * @returns Completion or a recoverable message; no card or scheduling state is changed.
 */
export async function copyCardMedia(deckId: string, filename: string, displayUrl: string, kind: CardMediaKind): Promise<Result<void>> {
  if (!validDeckId(deckId) || !validFilename(filename) || !['image', 'video'].includes(kind)) return { success:false, error:'Couldn’t identify that attachment. Reopen the card and try again.' };
  try {
    if (Capacitor.getPlatform() === 'ios') {
      if (!Capacitor.isPluginAvailable('MediaClipboard')) return { success:false, error:'Copy isn’t available in this build. Your media is still saved.' };
      // Bundled artwork is displayed with a root-relative src; the native file
      // resolver needs the same explicit local origin as other WebView URLs.
      const nativeDisplayUrl = new URL(displayUrl, 'capacitor://localhost').href;
      await clipboard.copy({ deckId, filename, displayUrl:nativeDisplayUrl, kind });
      return { success:true, data:undefined };
    }
    if (kind === 'video') return { success:false, error:'This browser can’t copy video files. Add the original video file to the other card instead.' };
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined' || (ClipboardItem.supports && !ClipboardItem.supports('image/png'))) {
      return { success:false, error:'This browser can’t copy photos. Use its Copy image command, or add the original file.' };
    }
    // Start the write within the original user gesture; WebKit accepts a promised blob.
    await navigator.clipboard.write([new ClipboardItem({ 'image/png':pngRepresentation(displayUrl) })]);
    return { success:true, data:undefined };
  } catch {
    return { success:false, error:'Couldn’t copy that media. Make sure its original file is available on this device, then try again.' };
  }
}
