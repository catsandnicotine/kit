/**
 * useExport — triggers an .apkg export and delivers it to the user.
 *
 * Browser (dev):  creates an object URL and triggers a download via <a>.
 * Native (Capacitor): writes to a temp file and opens the iOS share sheet.
 */

import { useCallback, useState } from 'react';
import type { Database } from 'sql.js';
import type { Result } from '../types';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { exportDeckAsApkgFresh, exportDeckAsApkgWithProgress } from '../lib/apkg/exporter';
import type { LoadMediaFn } from '../lib/apkg/exporter';
import { listMediaFilenames, loadMediaFile } from '../lib/platform/mediaFiles';
import { isNativePlatform } from '../lib/platform/platformDetect';
import type { UseDeckManagerReturn } from './useDeckManager';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ExportPhase = 'idle' | 'exporting' | 'done' | 'error';

export interface UseExportReturn {
  /** Current phase of the export pipeline. */
  phase: ExportPhase;
  /** Error message when phase is 'error'. */
  errorMessage: string;
  /** Export deck with all scheduling stripped (safe to share). */
  exportDeckFresh: (deckId: string, deckName: string) => Promise<void>;
  /** Export deck with FSRS states and review logs embedded. */
  exportDeckWithProgress: (deckId: string, deckName: string) => Promise<void>;
  /** Reset back to idle. */
  reset: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Hook that drives the .apkg export flow.
 *
 * Pass either the legacy monolithic db (old arch) or a deckManager (per-deck
 * arch). With a deckManager, the deck's per-deck db is opened on demand when
 * the user taps export.
 *
 * @param source - Legacy Database, or the per-deck UseDeckManagerReturn.
 * @returns Export state and actions.
 */
export function useExport(source: Database | UseDeckManagerReturn | null): UseExportReturn {
  const [phase, setPhase] = useState<ExportPhase>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  const reset = useCallback(() => {
    setPhase('idle');
    setErrorMessage('');
  }, []);

  // Build a filesystem-backed media loader for native exports.
  const nativeMediaLoader: LoadMediaFn = useCallback(async (deckId: string) => {
    const filenames = await listMediaFilenames(deckId);
    const result = [];
    for (const filename of filenames) {
      const data = await loadMediaFile(deckId, filename);
      if (data) {
        // Infer a basic mime type from the extension.
        const ext = filename.split('.').pop()?.toLowerCase() ?? '';
        const mimeMap: Record<string, string> = {
          jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
          gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
          mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4',
          mp4: 'video/mp4', webm: 'video/webm',
        };
        result.push({ filename, data, mimeType: mimeMap[ext] ?? 'application/octet-stream' });
      }
    }
    return result;
  }, []);

  const runExport = useCallback(
    async (
      deckId: string,
      deckName: string,
      exporter: (db: Database, id: string, loadMedia?: LoadMediaFn) => Promise<Result<Blob>>,
    ) => {
      setPhase('exporting');
      setErrorMessage('');

      let deckDb: Database | null = null;
      if (isDeckManager(source)) {
        deckDb = source.getCachedDeckDb(deckId) ?? await source.openDeckDb(deckId);
      } else {
        deckDb = source;
      }

      if (!deckDb) {
        setPhase('error');
        setErrorMessage('Could not open this deck. Please try again in a moment.');
        return;
      }

      const mediaLoader = isNativePlatform() ? nativeMediaLoader : undefined;

      try {
        const result = await exporter(deckDb, deckId, mediaLoader);
        if (!result.success) {
          setPhase('error');
          setErrorMessage(result.error);
          return;
        }

        const blob = result.data;
        const filename = `${sanitizeFilename(deckName)}.apkg`;

        if (isNativePlatform()) {
          await shareNative(blob, filename);
        } else {
          downloadBrowser(blob, filename);
        }

        setPhase('done');
      } catch (e) {
        setPhase('error');
        setErrorMessage(`Export failed: ${String(e)}`);
      }
    },
    [source, nativeMediaLoader],
  );

  const exportDeckFresh = useCallback(
    (deckId: string, deckName: string) =>
      runExport(deckId, deckName, exportDeckAsApkgFresh as (db: Database, id: string, loadMedia?: LoadMediaFn) => Promise<Result<Blob>>),
    [runExport],
  );

  const exportDeckWithProgress = useCallback(
    (deckId: string, deckName: string) =>
      runExport(deckId, deckName, exportDeckAsApkgWithProgress as (db: Database, id: string, loadMedia?: LoadMediaFn) => Promise<Result<Blob>>),
    [runExport],
  );

  return { phase, errorMessage, exportDeckFresh, exportDeckWithProgress, reset };
}

/** Narrow `source` to a DeckManager return by probing for its unique method. */
function isDeckManager(
  source: Database | UseDeckManagerReturn | null,
): source is UseDeckManagerReturn {
  return source !== null && typeof (source as UseDeckManagerReturn).openDeckDb === 'function';
}

// ---------------------------------------------------------------------------
// Delivery methods
// ---------------------------------------------------------------------------

/**
 * Trigger a browser download of the blob.
 *
 * @param blob     - The .apkg file blob.
 * @param filename - Suggested download filename.
 */
function downloadBrowser(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke after a short delay to ensure the download starts.
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/**
 * Write the blob to a temp file and open the iOS/Android share sheet.
 *
 * @param blob     - The .apkg file blob.
 * @param filename - Filename for the shared file.
 */
async function shareNative(blob: Blob, filename: string): Promise<void> {
  // Convert blob to base64
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const CHUNK = 8192;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
    parts.push(String.fromCharCode.apply(null, slice as unknown as number[]));
  }
  const base64 = btoa(parts.join(''));

  const writeResult = await Filesystem.writeFile({
    path: filename,
    data: base64,
    directory: Directory.Cache,
  });

  await Share.share({
    title: filename,
    url: writeResult.uri,
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Sanitize a deck name for use as a filename.
 *
 * @param name - Raw deck name.
 * @returns Safe filename string.
 */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[/\\:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 100) || 'deck';
}
