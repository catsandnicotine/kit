/**
 * Deck thumbnail persistence — saves cropped 200x200 JPEG thumbnails.
 *
 * On native: Capacitor Filesystem (Documents/thumbnails/).
 * In browser: localStorage base64.
 */

import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';

const THUMB_DIR = 'thumbnails';
const LS_PREFIX = 'kit_thumb_';

/**
 * Save a thumbnail for a deck.
 *
 * @param deckId - Deck UUID.
 * @param data   - JPEG image as base64 string (no data: prefix).
 */
export async function saveThumbnail(deckId: string, data: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    try {
      await Filesystem.mkdir({
        path: THUMB_DIR,
        directory: Directory.Documents,
        recursive: true,
      });
    } catch { /* already exists */ }
    await Filesystem.writeFile({
      path: `${THUMB_DIR}/${deckId}.jpg`,
      data,
      directory: Directory.Documents,
    });
  } else {
    try {
      localStorage.setItem(`${LS_PREFIX}${deckId}`, data);
    } catch { /* quota exceeded */ }
  }
}

/**
 * Load a thumbnail for a deck.
 *
 * @param deckId - Deck UUID.
 * @returns Base64 JPEG string, or null if not set.
 */
export async function loadThumbnail(deckId: string): Promise<string | null> {
  if (Capacitor.isNativePlatform()) {
    try {
      const result = await Filesystem.readFile({
        path: `${THUMB_DIR}/${deckId}.jpg`,
        directory: Directory.Documents,
      });
      return typeof result.data === 'string' ? result.data : null;
    } catch {
      return null;
    }
  } else {
    try {
      return localStorage.getItem(`${LS_PREFIX}${deckId}`);
    } catch {
      return null;
    }
  }
}

/**
 * Delete a thumbnail for a deck.
 *
 * @param deckId - Deck UUID.
 */
export async function deleteThumbnail(deckId: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    try {
      await Filesystem.deleteFile({
        path: `${THUMB_DIR}/${deckId}.jpg`,
        directory: Directory.Documents,
      });
    } catch { /* not found */ }
  } else {
    try {
      localStorage.removeItem(`${LS_PREFIX}${deckId}`);
    } catch { /* ignore */ }
  }
}

/**
 * Load all thumbnails for a list of deck IDs.
 *
 * @param deckIds - Array of deck UUIDs.
 * @returns Map from deckId to base64 data URL.
 */
export async function loadAllThumbnails(deckIds: string[]): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const promises = deckIds.map(async (id) => {
    const data = await loadThumbnail(id);
    if (data) {
      result[id] = `data:image/jpeg;base64,${data}`;
    }
  });
  await Promise.all(promises);
  return result;
}
