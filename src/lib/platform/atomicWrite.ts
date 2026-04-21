/**
 * Atomic file writes for Capacitor Filesystem.
 *
 * iOS's `FileManager.moveItem` (which Capacitor's `rename` wraps) throws if
 * the destination exists — unlike POSIX `rename(2)` which overwrites atomically.
 * A naive "write to .tmp then rename" therefore cannot replace an existing file.
 *
 * We use a `.tmp` + `.bak` scheme that keeps at least one complete file at
 * every point in the sequence, so an interruption (power loss, force-kill)
 * can never leave a half-written file in place of the real one:
 *
 *   0. Clean up any leftover `.bak` from a prior interrupted write.
 *   1. Write new content to `path.tmp`. (Interrupt here → real file untouched.)
 *   2. If real file exists, rename `path` → `path.bak`. (Atomic rename.)
 *   3. Rename `path.tmp` → `path`. (Atomic rename.)
 *   4. Delete `path.bak`. (Best-effort cleanup; leftover is cruft, not corruption.)
 *
 * At any interrupt point, either `path` or `path.bak` holds a fully-committed
 * copy. `atomicReadText` knows how to recover by promoting `.bak` when needed.
 *
 * Lives in lib/platform/ — no React, no UI imports.
 */

import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { isNativePlatform } from './platformDetect';

const TMP_SUFFIX = '.tmp';
const BAK_SUFFIX = '.bak';

export interface AtomicWriteParams {
  path: string;
  data: string;
  directory: Directory;
}

export interface AtomicReadParams {
  path: string;
  directory: Directory;
}

/**
 * Atomically write text to a file. Safe under interruption: readers will
 * always see either the previous committed content or the new content, never
 * a partially-written file.
 *
 * @param params.path      File path relative to `directory`.
 * @param params.data      UTF-8 text content.
 * @param params.directory Capacitor `Directory` enum value.
 */
export async function atomicWriteText(params: AtomicWriteParams): Promise<void> {
  const { path, data, directory } = params;

  // Browser dev fallback — single writeFile, no atomicity.
  if (!isNativePlatform()) {
    await Filesystem.writeFile({ path, data, directory, encoding: Encoding.UTF8 });
    return;
  }

  const tmpPath = path + TMP_SUFFIX;
  const bakPath = path + BAK_SUFFIX;

  // Step 0: clear any leftover .bak from a prior interrupted write so step 2
  // has a clean destination.
  try {
    await Filesystem.deleteFile({ path: bakPath, directory });
  } catch { /* no prior backup */ }

  // Step 1: write new content to .tmp. An interrupt here leaves the real
  // file untouched and .tmp as garbage (harmless — overwritten next time).
  await Filesystem.writeFile({
    path: tmpPath,
    data,
    directory,
    encoding: Encoding.UTF8,
  });

  // Step 2: if a real file exists, move it aside to .bak. From this point
  // until step 3 completes, .bak holds the last-committed state.
  let hadOldFile = false;
  try {
    await Filesystem.stat({ path, directory });
    hadOldFile = true;
  } catch { /* first-time write */ }

  if (hadOldFile) {
    await Filesystem.rename({ from: path, to: bakPath, directory, toDirectory: directory });
  }

  // Step 3: promote .tmp to the real path.
  try {
    await Filesystem.rename({ from: tmpPath, to: path, directory, toDirectory: directory });
  } catch (e) {
    // Step 3 failed after step 2 already moved the old file aside. Restore
    // the backup so readers still see the last-committed state instead of
    // finding nothing at `path`.
    if (hadOldFile) {
      try {
        await Filesystem.rename({ from: bakPath, to: path, directory, toDirectory: directory });
      } catch { /* best effort — atomicReadText will recover from .bak */ }
    }
    throw e;
  }

  // Step 4: delete the backup. A lingering .bak is cruft, not corruption;
  // the next atomicWriteText cleans it up in step 0.
  try {
    await Filesystem.deleteFile({ path: bakPath, directory });
  } catch { /* best effort */ }
}

/**
 * Read text written via {@link atomicWriteText}. If the real file is missing
 * but a `.bak` exists (from an interrupted write that got past step 2 but
 * not step 3), the backup is promoted and returned.
 *
 * @param params.path      File path relative to `directory`.
 * @param params.directory Capacitor `Directory` enum value.
 * @returns The file's UTF-8 text, or `null` if no valid file or backup exists.
 */
export async function atomicReadText(params: AtomicReadParams): Promise<string | null> {
  const { path, directory } = params;

  // Browser dev fallback — plain read.
  if (!isNativePlatform()) {
    try {
      const result = await Filesystem.readFile({ path, directory, encoding: Encoding.UTF8 });
      return typeof result.data === 'string' ? result.data : null;
    } catch {
      return null;
    }
  }

  // Normal path: real file exists.
  try {
    const result = await Filesystem.readFile({ path, directory, encoding: Encoding.UTF8 });
    return typeof result.data === 'string' ? result.data : null;
  } catch { /* fall through to backup recovery */ }

  // Recovery: interrupted mid-swap — .bak holds the last-committed state.
  const bakPath = path + BAK_SUFFIX;
  try {
    const result = await Filesystem.readFile({
      path: bakPath,
      directory,
      encoding: Encoding.UTF8,
    });
    if (typeof result.data !== 'string') return null;

    // Promote .bak → real so subsequent reads hit the fast path. If the
    // rename fails, the data is still readable via .bak next time around.
    try {
      await Filesystem.rename({
        from: bakPath,
        to: path,
        directory,
        toDirectory: directory,
      });
    } catch { /* best effort */ }

    return result.data;
  } catch {
    return null;
  }
}
