/**
 * editWriter — serializes and writes edit files to persistent storage.
 *
 * On native (Capacitor iOS), edit files are written to the iCloud ubiquity
 * container so they sync across devices. On browser, they are written to
 * localStorage as a development fallback.
 *
 * Each edit file is a small JSON document (~100-500 bytes) named
 * `{hlc}_{deviceId}.json` inside `Kit/{deckId}/edits/`.
 */

import type { EditFile, EditOp } from './types';
import type { HLCClock } from './hlc';
import type { SyncStorage } from './syncStorage';

/**
 * Write an edit file for a deck.
 *
 * @param storage  - Abstract storage backend (iCloud or localStorage).
 * @param clock    - HLC clock instance for this device.
 * @param deckId   - UUID of the deck this edit applies to.
 * @param ops      - One or more edit operations.
 * @returns The HLC string used as the edit identifier, or null on failure.
 */
export async function writeEdit(
  storage: SyncStorage,
  clock: HLCClock,
  deckId: string,
  ops: EditOp[],
): Promise<string | null> {
  if (ops.length === 0) return null;

  const hlc = clock.next();

  const editFile: EditFile = {
    v: 1,
    hlc,
    deviceId: clock.deviceId,
    deckId,
    ops,
  };

  const filename = `${hlc}.json`;
  const path = `${deckId}/edits/${filename}`;
  const data = JSON.stringify(editFile);

  try {
    await storage.writeFile(path, data);
    return hlc;
  } catch (e) {
    console.warn('[editWriter] Failed to write edit file:', path, e);
    // Queue for later if iCloud is unavailable
    try {
      await storage.queuePendingEdit(deckId, filename, data);
    } catch {
      // Best effort — the local SQLite write already succeeded
    }
    return hlc;
  }
}

/**
 * Flush any pending edits that were queued due to iCloud unavailability.
 *
 * @param storage - Abstract storage backend.
 * @returns Number of edits successfully flushed.
 */
export async function flushPendingEdits(
  storage: SyncStorage,
): Promise<number> {
  try {
    const pending = await storage.listPendingEdits();
    let flushed = 0;

    for (const { deckId, filename, data } of pending) {
      try {
        const path = `${deckId}/edits/${filename}`;
        await storage.writeFile(path, data);
        await storage.removePendingEdit(deckId, filename);
        flushed++;
      } catch {
        // Still unavailable — leave in queue
        break;
      }
    }

    return flushed;
  } catch {
    return 0;
  }
}
