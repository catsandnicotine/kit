/**
 * editWriter — serializes and persists edit files.
 *
 * Each user action (review, card edit, tag change) becomes one small JSON
 * edit file (~100-500 bytes). The write is local-first: the edit lands on
 * this device's disk, awaited, before the caller is told "done." iCloud
 * receives a mirror asynchronously; the user never waits on the network.
 *
 * When the iCloud mirror succeeds we remove the local queue entry, so the
 * steady state is "edits live in iCloud." When iCloud is slow, offline, or
 * full, the local copy remains and readers merge it alongside iCloud edits.
 *
 * This ordering closes the force-kill window: between "tap Good" and
 * "edit durable" there is now only the ~5ms of a tiny local file write.
 */

import type { EditFile, EditOp } from './types';
import type { HLCClock } from './hlc';
import type { SyncStorage } from './syncStorage';

/**
 * Write an edit file for a deck.
 *
 * Local disk is the source of truth for this device's unmirrored edits.
 * The function resolves as soon as the local write commits; the iCloud
 * mirror runs in the background and does not block the caller.
 *
 * @param storage  - Abstract storage backend (iCloud + local queue).
 * @param clock    - HLC clock instance for this device.
 * @param deckId   - UUID of the deck this edit applies to.
 * @param ops      - One or more edit operations.
 * @returns The HLC string used as the edit identifier, or null if no ops.
 * @throws If the durable local write fails (caller should surface this).
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

  // Durable local write — awaited. This is the promise we make to the user:
  // when the UI reports "saved," the edit is on disk and will survive a
  // force-kill, power loss, or OS memory-pressure termination.
  await storage.queuePendingEdit(deckId, filename, data);

  // Mirror to iCloud in the background. On success, remove the local queue
  // entry so the edit lives in one place (iCloud) rather than duplicated.
  // On failure, leave the local copy — flushPendingEdits will retry on the
  // next visibility change, and readers already merge local alongside iCloud.
  storage.writeFile(path, data).then(
    () => storage.removePendingEdit(deckId, filename).catch(() => {}),
    () => {},
  );

  return hlc;
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
