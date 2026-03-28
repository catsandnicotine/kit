/**
 * icloudSync — TypeScript wrapper around the ICloudSyncPlugin Swift bridge.
 *
 * Implements the SyncStorage interface using the iCloud ubiquity container
 * for file-level sync operations. Pending edits (when iCloud is unavailable)
 * are queued in the local Capacitor Filesystem.
 *
 * In browser mode, all operations are no-ops that return empty results.
 */

import { registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import type { SyncStorage, PendingEdit } from '../sync/syncStorage';

// ---------------------------------------------------------------------------
// Plugin interface
// ---------------------------------------------------------------------------

interface ICloudSyncPluginInterface {
  checkAvailability(): Promise<{ available: boolean }>;
  writeFile(options: { path: string; data: string }): Promise<void>;
  readFile(options: { path: string }): Promise<{ data: string | null }>;
  deleteFile(options: { path: string }): Promise<void>;
  listDirectory(options: { path: string }): Promise<{ files: string[] }>;
  fileExists(options: { path: string }): Promise<{ exists: boolean }>;
  getDownloadStatus(options: { path: string }): Promise<{ status: string }>;
  copyToICloud(options: { localPath: string; remotePath: string }): Promise<void>;
  copyFromICloud(options: { remotePath: string; localPath: string }): Promise<void>;
  startDownloading(options: { path: string }): Promise<void>;
  startWatching(options: { path: string }): Promise<void>;
  stopWatching(): Promise<void>;
}

const ICloudSyncPlugin = registerPlugin<ICloudSyncPluginInterface>('ICloudSyncPlugin');

// ---------------------------------------------------------------------------
// Environment detection
// ---------------------------------------------------------------------------

function isNativePlatform(): boolean {
  try {
    return !!(
      typeof window !== 'undefined' &&
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).Capacitor?.isNativePlatform?.()
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Pending edits storage (local filesystem)
// ---------------------------------------------------------------------------

const PENDING_DIR = 'pending_edits';

/**
 * Read pending edits from local filesystem.
 *
 * @returns Array of pending edits.
 */
async function readPendingEdits(): Promise<PendingEdit[]> {
  if (!isNativePlatform()) return [];

  try {
    const result = await Filesystem.readdir({
      path: PENDING_DIR,
      directory: Directory.Documents,
    });

    const edits: PendingEdit[] = [];
    for (const file of result.files) {
      const name = typeof file === 'string' ? file : file.name;
      if (!name.endsWith('.json')) continue;

      try {
        const content = await Filesystem.readFile({
          path: `${PENDING_DIR}/${name}`,
          directory: Directory.Documents,
        });
        const data = typeof content.data === 'string' ? content.data : '';
        const parsed = JSON.parse(data);
        if (parsed.deckId && parsed.filename && parsed.data) {
          edits.push(parsed as PendingEdit);
        }
      } catch {
        // Skip corrupted pending edits
      }
    }

    return edits;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// iCloud SyncStorage implementation
// ---------------------------------------------------------------------------

/**
 * Create a SyncStorage backed by the iCloud ubiquity container.
 *
 * @returns SyncStorage instance for native iOS.
 */
export function createICloudSyncStorage(): SyncStorage {
  return {
    async writeFile(path: string, data: string): Promise<void> {
      if (!isNativePlatform()) return;
      await ICloudSyncPlugin.writeFile({ path, data });
    },

    async readFile(path: string): Promise<string | null> {
      if (!isNativePlatform()) return null;
      const result = await ICloudSyncPlugin.readFile({ path });
      return result.data ?? null;
    },

    async deleteFile(path: string): Promise<void> {
      if (!isNativePlatform()) return;
      await ICloudSyncPlugin.deleteFile({ path });
    },

    async listDirectory(dirPath: string): Promise<string[]> {
      if (!isNativePlatform()) return [];
      const result = await ICloudSyncPlugin.listDirectory({ path: dirPath });
      return result.files ?? [];
    },

    async fileExists(path: string): Promise<boolean> {
      if (!isNativePlatform()) return false;
      const result = await ICloudSyncPlugin.fileExists({ path });
      return result.exists ?? false;
    },

    async copyFileToSync(localPath: string, remotePath: string): Promise<void> {
      if (!isNativePlatform()) return;
      await ICloudSyncPlugin.copyToICloud({ localPath, remotePath });
    },

    async copyFileFromSync(remotePath: string, localPath: string): Promise<void> {
      if (!isNativePlatform()) return;
      await ICloudSyncPlugin.copyFromICloud({ remotePath, localPath });
    },

    async queuePendingEdit(deckId: string, filename: string, data: string): Promise<void> {
      if (!isNativePlatform()) return;

      try {
        await Filesystem.mkdir({
          path: PENDING_DIR,
          directory: Directory.Documents,
          recursive: true,
        });
      } catch {
        // May already exist
      }

      const pendingFilename = `${deckId}_${filename}`;
      const content = JSON.stringify({ deckId, filename, data });

      await Filesystem.writeFile({
        path: `${PENDING_DIR}/${pendingFilename}`,
        data: content,
        directory: Directory.Documents,
      });
    },

    async listPendingEdits(): Promise<PendingEdit[]> {
      return readPendingEdits();
    },

    async removePendingEdit(deckId: string, filename: string): Promise<void> {
      if (!isNativePlatform()) return;
      const pendingFilename = `${deckId}_${filename}`;
      try {
        await Filesystem.deleteFile({
          path: `${PENDING_DIR}/${pendingFilename}`,
          directory: Directory.Documents,
        });
      } catch {
        // Already removed
      }
    },

    async isAvailable(): Promise<boolean> {
      if (!isNativePlatform()) return false;
      try {
        const result = await ICloudSyncPlugin.checkAvailability();
        return result.available;
      } catch {
        return false;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Additional native utilities
// ---------------------------------------------------------------------------

/**
 * Start watching a path in iCloud for changes from other devices.
 *
 * @param path - Relative path to watch (e.g. empty string for all decks).
 */
export async function startICloudWatching(path: string): Promise<void> {
  if (!isNativePlatform()) return;
  await ICloudSyncPlugin.startWatching({ path });
}

/**
 * Stop watching for iCloud changes.
 */
export async function stopICloudWatching(): Promise<void> {
  if (!isNativePlatform()) return;
  await ICloudSyncPlugin.stopWatching();
}

/** Shape of the icloudFilesChanged event payload from the Swift plugin. */
export interface ICloudFileChange {
  path: string;
  event: 'added' | 'changed' | 'removed';
}

/**
 * Register a listener for iCloud file change events from other devices.
 *
 * @param callback - Called with an array of file changes.
 * @returns A handle to remove the listener, or null on non-native platforms.
 */
export async function addICloudChangeListener(
  callback: (changes: ICloudFileChange[]) => void,
): Promise<PluginListenerHandle | null> {
  if (!isNativePlatform()) return null;
  const handle = await (ICloudSyncPlugin as unknown as {
    addListener: (event: string, cb: (data: { files: ICloudFileChange[] }) => void) => Promise<PluginListenerHandle>;
  }).addListener('icloudFilesChanged', (data) => {
    callback(data.files ?? []);
  });
  return handle;
}

/**
 * Get the download status of a file in iCloud.
 *
 * @param path - Relative path.
 * @returns 'downloaded' | 'not-downloaded' | 'unknown' | 'unavailable'
 */
export async function getICloudDownloadStatus(
  path: string,
): Promise<string> {
  if (!isNativePlatform()) return 'unavailable';
  try {
    const result = await ICloudSyncPlugin.getDownloadStatus({ path });
    return result.status;
  } catch {
    return 'unknown';
  }
}

/**
 * Trigger download of an evicted iCloud file.
 *
 * @param path - Relative path.
 */
export async function triggerICloudDownload(path: string): Promise<void> {
  if (!isNativePlatform()) return;
  await ICloudSyncPlugin.startDownloading({ path });
}
