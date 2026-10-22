/**
 * editReader — reads and parses edit files from sync storage.
 *
 * Used during:
 *   - App launch: replay edits newer than the local watermark
 *   - Sync notification: replay edits from other devices
 *   - Compaction: gather all edits to merge into a snapshot
 */

import type { EditFile } from './types';
import type { SyncStorage } from './syncStorage';
import { compareHLC } from './hlc';

/**
 * Read and parse edit files that are queued locally for this device,
 * filtered to a single deck. These represent edits whose iCloud mirror
 * has not yet succeeded (or whose local copy hasn't been cleaned up
 * after a successful mirror).
 *
 * @param storage - Abstract storage backend (for listPendingEdits).
 * @param deckId  - UUID of the deck to filter for.
 * @returns Parsed edit files for this deck that live in the local queue.
 */
async function readLocalPendingEdits(
  storage: SyncStorage,
  deckId: string,
): Promise<EditFile[]> {
  let pending;
  try {
    pending = await storage.listPendingEdits();
  } catch {
    return [];
  }

  const edits: EditFile[] = [];
  for (const entry of pending) {
    if (entry.deckId !== deckId) continue;
    try {
      const parsed = JSON.parse(entry.data) as EditFile;
      if (parsed.v === 1 && parsed.ops && Array.isArray(parsed.ops)) {
        edits.push(parsed);
      }
    } catch {
      // Skip malformed pending entry
    }
  }
  return edits;
}

/**
 * Read all edit files for a deck, sorted by HLC (oldest first).
 *
 * @param storage - Abstract storage backend.
 * @param deckId  - UUID of the deck.
 * @returns Array of parsed edit files, sorted by HLC ascending.
 */
export async function readAllEdits(
  storage: SyncStorage,
  deckId: string,
): Promise<EditFile[]> {
  const dirPath = `${deckId}/edits`;
  let filenames: string[];

  try {
    filenames = await storage.listDirectory(dirPath);
  } catch {
    return [];
  }

  // Filter to .json files and sort lexicographically (HLC order)
  const jsonFiles = filenames
    .filter(f => f.endsWith('.json'))
    .sort();

  const edits: EditFile[] = [];

  for (const filename of jsonFiles) {
    const path = `${dirPath}/${filename}`;
    try {
      const data = await storage.readFile(path);
      if (!data) continue;

      const parsed = JSON.parse(data) as EditFile;
      if (parsed.v === 1 && parsed.ops && Array.isArray(parsed.ops)) {
        edits.push(parsed);
      }
    } catch (e) {
      console.warn('[editReader] Failed to parse edit file:', path, e);
      // Skip corrupted files
    }
  }

  return edits;
}

/**
 * Read edit files newer than a given HLC watermark, merging local pending
 * edits (this device's unmirrored writes) with iCloud edits (mirrored +
 * edits from other devices). An edit present in both sources is deduped
 * by HLC — each HLC is unique per device, so duplicates are the same
 * edit observed twice during the mirror transition.
 *
 * @param storage   - Abstract storage backend.
 * @param deckId    - UUID of the deck.
 * @param afterHLC  - Only return edits with HLC strictly greater than this value.
 *                    Pass empty string to get all edits.
 * @returns Array of parsed edit files newer than the watermark, sorted ascending.
 */
export async function readEditsAfter(
  storage: SyncStorage,
  deckId: string,
  afterHLC: string,
): Promise<EditFile[]> {
  const [icloud, local] = await Promise.all([
    readAllEdits(storage, deckId),
    readLocalPendingEdits(storage, deckId),
  ]);

  const byHlc = new Map<string, EditFile>();
  for (const edit of icloud) byHlc.set(edit.hlc, edit);
  for (const edit of local) byHlc.set(edit.hlc, edit);

  const all = Array.from(byHlc.values()).sort((a, b) => compareHLC(a.hlc, b.hlc));

  if (!afterHLC) return all;
  return all.filter(edit => compareHLC(edit.hlc, afterHLC) > 0);
}

/**
 * Read the deck snapshot.
 *
 * @param storage - Abstract storage backend.
 * @param deckId  - UUID of the deck.
 * @returns The parsed snapshot, or null if none exists.
 */
export async function readSnapshot(
  storage: SyncStorage,
  deckId: string,
): Promise<import('./types').DeckSnapshot | null> {
  const path = `${deckId}/snapshot.json`;
  try {
    const data = await storage.readFile(path);
    if (!data) return null;
    const parsed = JSON.parse(data);
    if (parsed.v === 1) return parsed;
    return null;
  } catch {
    return null;
  }
}

/**
 * List all deck IDs that have data in sync storage.
 * Scans the root directory for subdirectories that contain a snapshot.json.
 *
 * @param storage - Abstract storage backend.
 * @returns Array of deck UUIDs found in sync storage.
 */
export async function listSyncedDeckIds(
  storage: SyncStorage,
): Promise<string[]> {
  try {
    const entries = await storage.listDirectory('');
    const deckIds: string[] = [];

    for (const entry of entries) {
      // Check if this looks like a UUID and has a snapshot
      if (entry.includes('.')) continue; // Skip files at root level
      const hasSnapshot = await storage.fileExists(`${entry}/snapshot.json`);
      if (hasSnapshot) deckIds.push(entry);
    }

    return deckIds;
  } catch {
    return [];
  }
}
