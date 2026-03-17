/**
 * useExport — triggers an .apkg export and delivers it to the user.
 *
 * Browser (dev):  creates an object URL and triggers a download via <a>.
 * Native (Capacitor): writes to a temp file and opens the iOS share sheet.
 */

import { useCallback, useState } from 'react';
import type { Database } from 'sql.js';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { exportDeckAsApkg } from '../lib/apkg/exporter';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ExportPhase = 'idle' | 'exporting' | 'done' | 'error';

export interface UseExportReturn {
  /** Current phase of the export pipeline. */
  phase: ExportPhase;
  /** Error message when phase is 'error'. */
  errorMessage: string;
  /** Start the export for a given deck. */
  exportDeck: (deckId: string, deckName: string) => Promise<void>;
  /** Reset back to idle. */
  reset: () => void;
}

// ---------------------------------------------------------------------------
// Platform detection
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
// Hook
// ---------------------------------------------------------------------------

/**
 * Hook that drives the .apkg export flow.
 *
 * @param db - sql.js Database instance (null while loading).
 * @returns Export state and actions.
 */
export function useExport(db: Database | null): UseExportReturn {
  const [phase, setPhase] = useState<ExportPhase>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  const reset = useCallback(() => {
    setPhase('idle');
    setErrorMessage('');
  }, []);

  const exportDeck = useCallback(
    async (deckId: string, deckName: string) => {
      if (!db) {
        setPhase('error');
        setErrorMessage('Database is not ready yet.');
        return;
      }

      setPhase('exporting');
      setErrorMessage('');

      try {
        const result = await exportDeckAsApkg(db, deckId);
        if (!result.success) {
          setPhase('error');
          setErrorMessage(result.error);
          return;
        }

        const blob = result.data;
        const filename = `${sanitizeFilename(deckName)}.apkg`;

        if (isNativePlatform()) {
          try {
            await shareNative(blob, filename);
          } catch {
            // Plugin not available — fall back to browser download.
            downloadBrowser(blob, filename);
          }
        } else {
          downloadBrowser(blob, filename);
        }

        setPhase('done');
      } catch (e) {
        setPhase('error');
        setErrorMessage(`Export failed: ${String(e)}`);
      }
    },
    [db],
  );

  return { phase, errorMessage, exportDeck, reset };
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
