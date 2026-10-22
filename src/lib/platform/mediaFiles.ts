/**
 * mediaFiles — stores deck media (images, audio) as individual files on the
 * Capacitor Filesystem instead of as BLOBs inside the SQLite database.
 *
 * Storing BLOBs in SQLite causes the database snapshot to grow to 50-150 MB,
 * which OOM-crashes the WKWebView process every time the app tries to load it
 * (loading requires ~3× the file size in memory: base64 string + Uint8Array +
 * WASM heap copy).
 *
 * Layout on disk:
 *   Documents/media/{deckId}/{filename}
 *
 * On native (Capacitor iOS), Capacitor.convertFileSrc() is used to get a
 * capacitor:// URL that WKWebView can serve directly — no JS memory needed.
 *
 * Browser previews use the origin-private filesystem so media survives both
 * temporary import databases and page reloads.
 */

import { Filesystem, Directory } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';
import { uint8ToBase64, base64ToUint8 } from './persistence';
import { isNativePlatform } from './platformDetect';

import { saveBrowserMedia, saveBrowserMediaBlob, readBrowserMedia, listBrowserMedia, deleteBrowserMedia } from './browserMediaFiles';

const MEDIA_ROOT = 'media';

/** Store a new attachment with bounded memory use and without overwriting older media.
 * @param deckId - Safe single-segment deck owner, validated by the attachment caller.
 * @param filename - New generated filename.
 * @param data - Original file-backed photo or video.
 * @returns Completion after the whole file is written; generated partial files are cleaned up.
 */
export async function saveMediaBlobFile(deckId: string, filename: string, data: Blob): Promise<void> {
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(deckId) || !filename || /[\\/]/.test(filename) || filename === '.' || filename === '..'
    || [...filename].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) throw new Error('Invalid media location');
  if (!isNativePlatform()) return saveBrowserMediaBlob(deckId, filename, data);
  const folder = `${MEDIA_ROOT}/${deckId}`;
  const path = `${folder}/${filename}`;
  try { await Filesystem.mkdir({ path:folder, directory:Directory.Documents, recursive:true }); }
  catch (error) {
    if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'OS-PLUG-FILE-0010')) throw error;
  }
  const existing = await Filesystem.readdir({ path:folder, directory:Directory.Documents });
  if (existing.files.some(file => (typeof file === 'string' ? file : file.name) === filename)) throw new Error('Media already exists');
  const chunkSize = 512 * 1024;
  try {
    for (let offset = 0; offset < Math.max(1, data.size); offset += chunkSize) {
      const chunk = new Uint8Array(await data.slice(offset, offset + chunkSize).arrayBuffer());
      const options = { path, directory:Directory.Documents, data:uint8ToBase64(chunk) };
      if (offset === 0) await Filesystem.writeFile(options);
      else await Filesystem.appendFile(options);
    }
  } catch (error) {
    // The existence check and unique filename ensure this is only our partial write.
    await Filesystem.deleteFile({ path, directory:Directory.Documents }).catch(cleanupError => console.warn('Could not remove an incomplete media file', cleanupError));
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Save a media file to the filesystem under Documents/media/{deckId}/{filename}.
 * Creates the directory if it does not exist.
 *
 * @param deckId   - Kit deck UUID.
 * @param filename - Original media filename (e.g. "cat.jpg").
 * @param data     - Raw file bytes.
 */
export async function saveMediaFile(
  deckId: string,
  filename: string,
  data: Uint8Array,
): Promise<void> {
  if (!isNativePlatform()) return saveBrowserMedia(deckId, filename, data);
  if (filename.includes('/') || filename.includes('\\') || filename === '.' || filename === '..') throw new Error('Invalid media filename');
  try {
    // Ensure the deck media directory exists before writing.
    await Filesystem.mkdir({
      path: `${MEDIA_ROOT}/${deckId}`,
      directory: Directory.Documents,
      recursive: true,
    });
  } catch {
    // Directory may already exist — ignore.
  }
  const base64 = uint8ToBase64(data);
  await Filesystem.writeFile({
    path: `${MEDIA_ROOT}/${deckId}/${filename}`,
    data: base64,
    directory: Directory.Documents,
  });
}

/**
 * Load a media file's bytes from the filesystem.
 * Used during export to re-package media into an .apkg ZIP.
 *
 * @param deckId   - Kit deck UUID.
 * @param filename - Media filename.
 * @returns Raw bytes, or null if not found.
 */
export async function loadMediaFile(
  deckId: string,
  filename: string,
): Promise<Uint8Array | null> {
  if (!isNativePlatform()) {
    const file = await readBrowserMedia(deckId, filename);
    return file ? new Uint8Array(await file.arrayBuffer()) : null;
  }
  try {
    const result = await Filesystem.readFile({
      path: `${MEDIA_ROOT}/${deckId}/${filename}`,
      directory: Directory.Documents,
    });
    if (typeof result.data === 'string') return base64ToUint8(result.data);
    if (result.data instanceof Blob) {
      const buf = await result.data.arrayBuffer();
      return new Uint8Array(buf);
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * List all media filenames stored for a deck.
 *
 * @param deckId - Kit deck UUID.
 * @returns Array of filenames (e.g. ["cat.jpg", "audio.mp3"]).
 */
export async function listMediaFilenames(deckId: string): Promise<string[]> {
  if (!isNativePlatform()) return listBrowserMedia(deckId);
  try {
    const result = await Filesystem.readdir({
      path: `${MEDIA_ROOT}/${deckId}`,
      directory: Directory.Documents,
    });
    return result.files.map(f => (typeof f === 'string' ? f : f.name));
  } catch {
    return [];
  }
}

/**
 * Get the native directory URI for a deck's media folder.
 * Used with Capacitor.convertFileSrc() to build web-accessible URLs.
 *
 * @param deckId - Kit deck UUID.
 * @returns Native file:// URI string, or empty string if not available.
 */
export async function getMediaDirUri(deckId: string): Promise<string> {
  if (!isNativePlatform()) return '';
  try {
    const result = await Filesystem.getUri({
      path: `${MEDIA_ROOT}/${deckId}`,
      directory: Directory.Documents,
    });
    return result.uri;
  } catch {
    return '';
  }
}

/**
 * Convert a native file:// URI to a capacitor:// URL that WKWebView can serve.
 * Returns the native URI unchanged in non-Capacitor environments.
 *
 * @param nativeUri - file:// URI from getMediaDirUri.
 * @param filename  - Media filename.
 * @returns Web-accessible URL.
 */
export function mediaUriToWebUrl(nativeUri: string, filename: string): string {
  const full = `${nativeUri}/${encodeURIComponent(filename)}`;
  return Capacitor.convertFileSrc(full);
}

/**
 * Get the web-accessible URL for a single media file.
 * Combines getMediaDirUri + mediaUriToWebUrl in one call.
 *
 * @param deckId   - Kit deck UUID.
 * @param filename - Media filename.
 * @returns capacitor:// URL, or empty string if unavailable.
 */
export async function getMediaFileWebUrl(deckId: string, filename: string): Promise<string> {
  if (!isNativePlatform()) {
    const file = await readBrowserMedia(deckId, filename);
    if (!file) return '';
    const extension = filename.split('.').pop()?.toLowerCase() ?? '';
    const types: Record<string, string> = { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif', webp:'image/webp', svg:'image/svg+xml', heic:'image/heic', heif:'image/heif', avif:'image/avif', bmp:'image/bmp', tif:'image/tiff', tiff:'image/tiff', mp3:'audio/mpeg', mp4:'video/mp4', mov:'video/quicktime', m4v:'video/x-m4v', webm:'video/webm', ogv:'video/ogg', m4a:'audio/mp4', ogg:'audio/ogg', wav:'audio/wav', woff:'font/woff', woff2:'font/woff2', ttf:'font/ttf', otf:'font/otf', css:'text/css' };
    return URL.createObjectURL(file.slice(0, file.size, types[extension] ?? 'application/octet-stream'));
  }
  try {
    const result = await Filesystem.getUri({
      path: `${MEDIA_ROOT}/${deckId}/${filename}`,
      directory: Directory.Documents,
    });
    return Capacitor.convertFileSrc(result.uri);
  } catch {
    return '';
  }
}

/**
 * Delete all media files for a deck (e.g. when the deck is deleted).
 * Silently ignores errors (e.g. directory never existed).
 *
 * @param deckId - Kit deck UUID.
 */
export async function deleteMediaForDeck(deckId: string): Promise<void> {
  if (!isNativePlatform()) return deleteBrowserMedia(deckId);
  try {
    await Filesystem.rmdir({
      path: `${MEDIA_ROOT}/${deckId}`,
      directory: Directory.Documents,
      recursive: true,
    });
  } catch {
    // Directory may not exist — ignore.
  }
}

/**
 * Evict media for decks no longer in the registry (orphaned or deleted).
 * Call this periodically (e.g. on app init) to prevent media cache bloat.
 *
 * @param activeDeckIds - Set of deck IDs that are still in the registry.
 * @returns Number of deck media directories removed.
 */
export async function evictOrphanedMedia(
  activeDeckIds: Set<string>,
): Promise<number> {
  if (!isNativePlatform()) return 0;
  try {
    const result = await Filesystem.readdir({
      path: MEDIA_ROOT,
      directory: Directory.Documents,
    });
    const orphans = result.files
      .map(f => typeof f === 'string' ? f : f.name)
      .filter(name => !activeDeckIds.has(name));

    const results = await Promise.allSettled(
      orphans.map(name =>
        Filesystem.rmdir({
          path: `${MEDIA_ROOT}/${name}`,
          directory: Directory.Documents,
          recursive: true,
        }),
      ),
    );
    return results.filter(r => r.status === 'fulfilled').length;
  } catch {
    // Media root may not exist yet
    return 0;
  }
}

/**
 * One-time migration: extract all media BLOBs from the SQLite database and
 * write them to the filesystem. After all files are saved, clears the media
 * table so the database snapshot shrinks dramatically.
 *
 * This is called after a successful DB load in useDatabase. It is safe to
 * call multiple times — if the media table is already empty it returns
 * immediately.
 *
 * @param db               - Open sql.js Database instance.
 * @param saveDatabaseSnapshot - Callback to persist the shrunken DB after migration.
 */
export async function migrateMediaBlobsToFiles(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  saveDatabaseSnapshot: (data: Uint8Array) => Promise<void>,
): Promise<void> {
  if (!isNativePlatform()) return;
  try {
    // Quick check: are there any rows at all?
    const check = db.exec('SELECT 1 FROM media LIMIT 1') as { values: unknown[][] }[];
    if (!check.length || !check[0]?.values.length) return;

    // Iterate rows one at a time so we do not materialise the whole blob array.
    const stmt = db.prepare('SELECT deck_id, filename, data, mime_type FROM media') as {
      step(): boolean;
      getAsObject(): Record<string, unknown>;
      free(): void;
    };

    let count = 0;
    while (stmt.step()) {
      const row = stmt.getAsObject();
      const deckId  = String(row['deck_id']  ?? '');
      const filename = String(row['filename'] ?? '');
      const data     = row['data'];
      if (data instanceof Uint8Array && deckId && filename) {
        await saveMediaFile(deckId, filename, data);
        count++;
      }
    }
    stmt.free();

    if (count === 0) return;

    // Clear BLOBs — shrinks the snapshot from ~100 MB to ~5-10 MB.
    db.run('DELETE FROM media');

    const exported: Uint8Array = db.export();
    await saveDatabaseSnapshot(exported);
  } catch (e) {
    // Migration failure is non-fatal — blobs stay in DB and media still
    // works via the old DB path; the next launch will retry.
    console.warn('[mediaFiles] BLOB migration failed:', e);
  }
}
