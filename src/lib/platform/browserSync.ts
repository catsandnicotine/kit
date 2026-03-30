/**
 * browserSync — SyncStorage implementation for browser dev mode.
 *
 * Uses localStorage to simulate iCloud sync operations.
 * No real cross-device sync — purely for local development.
 *
 * Keys are prefixed with `kit_sync:` to avoid collisions.
 */

import type { SyncStorage, PendingEdit } from '../sync/syncStorage';

const PREFIX = 'kit_sync:';
const PENDING_PREFIX = 'kit_pending:';

/**
 * Create a SyncStorage backed by localStorage (browser dev mode).
 *
 * @returns SyncStorage instance for browser development.
 */
export function createBrowserSyncStorage(): SyncStorage {
  return {
    async writeFile(path: string, data: string): Promise<void> {
      localStorage.setItem(`${PREFIX}${path}`, data);
      // Track directory contents
      trackFileInDirectory(path);
    },

    async readFile(path: string): Promise<string | null> {
      return localStorage.getItem(`${PREFIX}${path}`);
    },

    async deleteFile(path: string): Promise<void> {
      localStorage.removeItem(`${PREFIX}${path}`);
      untrackFileFromDirectory(path);
    },

    async listDirectory(dirPath: string): Promise<string[]> {
      const dirKey = `${PREFIX}__dir:${dirPath}`;
      const json = localStorage.getItem(dirKey);
      if (!json) return [];
      try {
        const files = JSON.parse(json);
        return Array.isArray(files) ? files : [];
      } catch {
        return [];
      }
    },

    async fileExists(path: string): Promise<boolean> {
      return localStorage.getItem(`${PREFIX}${path}`) !== null;
    },

    async copyFileToSync(_localPath: string, remotePath: string): Promise<void> {
      // In browser mode, .apkg copy is a no-op (media stays in DB blobs)
      localStorage.setItem(`${PREFIX}${remotePath}`, '__binary_placeholder__');
      trackFileInDirectory(remotePath);
    },

    async copyFileFromSync(_remotePath: string, _localPath: string): Promise<void> {
      // No-op in browser
    },

    async queuePendingEdit(deckId: string, filename: string, data: string): Promise<void> {
      const key = `${PENDING_PREFIX}${deckId}_${filename}`;
      localStorage.setItem(key, JSON.stringify({ deckId, filename, data }));
    },

    async listPendingEdits(): Promise<PendingEdit[]> {
      const edits: PendingEdit[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key?.startsWith(PENDING_PREFIX)) continue;
        try {
          const val = localStorage.getItem(key);
          if (val) {
            const parsed = JSON.parse(val);
            if (parsed.deckId && parsed.filename && parsed.data) {
              edits.push(parsed as PendingEdit);
            }
          }
        } catch {
          // Skip
        }
      }
      return edits;
    },

    async removePendingEdit(deckId: string, filename: string): Promise<void> {
      localStorage.removeItem(`${PENDING_PREFIX}${deckId}_${filename}`);
    },

    async isAvailable(): Promise<boolean> {
      return true; // Always available in browser
    },
  };
}

// ---------------------------------------------------------------------------
// Directory tracking helpers
// ---------------------------------------------------------------------------

/**
 * Track a file in its parent directory listing.
 *
 * @param path - Full relative path of the file.
 */
function trackFileInDirectory(path: string): void {
  const lastSlash = path.lastIndexOf('/');
  if (lastSlash < 0) return;
  const dirPath = path.slice(0, lastSlash);
  const filename = path.slice(lastSlash + 1);

  const dirKey = `${PREFIX}__dir:${dirPath}`;
  let files: string[] = [];
  try {
    const existing = localStorage.getItem(dirKey);
    if (existing) files = JSON.parse(existing);
  } catch {
    files = [];
  }

  if (!files.includes(filename)) {
    files.push(filename);
    localStorage.setItem(dirKey, JSON.stringify(files));
  }
}

/**
 * Remove a file from its parent directory listing.
 *
 * @param path - Full relative path of the file.
 */
function untrackFileFromDirectory(path: string): void {
  const lastSlash = path.lastIndexOf('/');
  if (lastSlash < 0) return;
  const dirPath = path.slice(0, lastSlash);
  const filename = path.slice(lastSlash + 1);

  const dirKey = `${PREFIX}__dir:${dirPath}`;
  try {
    const existing = localStorage.getItem(dirKey);
    if (!existing) return;
    const files: string[] = JSON.parse(existing);
    const filtered = files.filter(f => f !== filename);
    localStorage.setItem(dirKey, JSON.stringify(filtered));
  } catch {
    // Skip
  }
}
