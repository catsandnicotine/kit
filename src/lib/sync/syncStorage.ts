/**
 * syncStorage — abstract storage interface for the sync layer.
 *
 * Implementations:
 *   - iCloudSyncStorage (native iOS): reads/writes to iCloud ubiquity container
 *   - localSyncStorage (browser dev): reads/writes to localStorage
 *
 * All paths are relative to the app's sync root (e.g. `Kit/` in iCloud).
 * Example path: `{deckId}/edits/{hlc}.json`
 */

// ---------------------------------------------------------------------------
// Pending Edit (queued when iCloud is unavailable)
// ---------------------------------------------------------------------------

/** A pending edit waiting to be flushed to iCloud. */
export interface PendingEdit {
  deckId: string;
  filename: string;
  data: string;
}

// ---------------------------------------------------------------------------
// Abstract Storage Interface
// ---------------------------------------------------------------------------

/**
 * Abstract storage backend for sync operations.
 * All paths are relative to the sync root.
 */
export interface SyncStorage {
  /**
   * Write a string to a file, creating parent directories as needed.
   *
   * @param path - Relative path (e.g. `{deckId}/edits/{hlc}.json`).
   * @param data - String content to write.
   */
  writeFile(path: string, data: string): Promise<void>;

  /**
   * Read a file's string content.
   *
   * @param path - Relative path.
   * @returns File content, or null if the file does not exist.
   */
  readFile(path: string): Promise<string | null>;

  /**
   * Delete a file.
   *
   * @param path - Relative path.
   */
  deleteFile(path: string): Promise<void>;

  /**
   * List filenames in a directory (non-recursive).
   *
   * @param dirPath - Relative directory path (e.g. `{deckId}/edits`).
   * @returns Array of filenames (not full paths).
   */
  listDirectory(dirPath: string): Promise<string[]>;

  /**
   * Check whether a file exists.
   *
   * @param path - Relative path.
   * @returns True if the file exists and is downloaded.
   */
  fileExists(path: string): Promise<boolean>;

  /**
   * Copy a local file to the sync storage (used for .apkg files).
   *
   * @param localPath  - Absolute local file path.
   * @param remotePath - Relative path in sync storage.
   */
  copyFileToSync(localPath: string, remotePath: string): Promise<void>;

  /**
   * Copy a file from sync storage to a local path (used for .apkg download).
   *
   * @param remotePath - Relative path in sync storage.
   * @param localPath  - Absolute local file path.
   */
  copyFileFromSync(remotePath: string, localPath: string): Promise<void>;

  /**
   * Queue a pending edit for later flush (when iCloud is unavailable).
   *
   * @param deckId   - Deck UUID.
   * @param filename - Edit filename.
   * @param data     - Serialized edit JSON.
   */
  queuePendingEdit(deckId: string, filename: string, data: string): Promise<void>;

  /**
   * List all pending edits across all decks.
   *
   * @returns Array of pending edits.
   */
  listPendingEdits(): Promise<PendingEdit[]>;

  /**
   * Remove a pending edit after it has been successfully flushed.
   *
   * @param deckId   - Deck UUID.
   * @param filename - Edit filename.
   */
  removePendingEdit(deckId: string, filename: string): Promise<void>;

  /**
   * Check if the sync backend is available (e.g. iCloud signed in).
   *
   * @returns True if sync storage is available.
   */
  isAvailable(): Promise<boolean>;
}
