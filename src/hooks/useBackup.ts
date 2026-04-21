/**
 * useBackup — drives the iCloud "Sync Now" control in Settings.
 *
 * In the per-deck sync architecture, every edit is already written to iCloud
 * as it happens. This hook surfaces a manual flush so the user can force any
 * edits queued while offline to push now, and reports the result.
 *
 * `scheduleICloudBackup` is retained as a module-level no-op shim for legacy
 * callers on the pre-per-deck path (useCardEditor, useDeckImport, useDatabase).
 * In the new arch those callers route through writeEdit and never reach here.
 */

import { useCallback, useState } from 'react';
import type { UseDeckManagerReturn } from './useDeckManager';
import type { ICloudAvailability } from './useICloudAvailability';
import { isNativePlatform } from '../lib/platform/platformDetect';

export function scheduleICloudBackup(): void {
  // No-op: per-deck arch handles iCloud writes inline via writeEdit.
}

export type BackupPhase = 'idle' | 'syncing' | 'done' | 'error';

export interface UseBackupReturn {
  phase: BackupPhase;
  errorMessage: string;
  flushedCount: number;
  backupNow: () => Promise<void>;
  reset: () => void;
}

/**
 * Hook that exposes a manual "Sync Now" flush for the Settings page.
 *
 * @param deckManager  - Per-deck manager (null while loading).
 * @param availability - Shared iCloud availability state from useICloudAvailability.
 */
export function useBackup(
  deckManager: UseDeckManagerReturn | null,
  availability: ICloudAvailability,
): UseBackupReturn {
  const [phase, setPhase] = useState<BackupPhase>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [flushedCount, setFlushedCount] = useState(0);

  const reset = useCallback(() => {
    setPhase('idle');
    setErrorMessage('');
  }, []);

  const backupNow = useCallback(async () => {
    if (!deckManager) {
      setPhase('error');
      setErrorMessage('Kit is still loading your decks. Please try again in a moment.');
      return;
    }

    if (!isNativePlatform()) {
      setPhase('error');
      setErrorMessage('iCloud sync is only available on iOS.');
      return;
    }

    if (availability !== 'available') {
      setPhase('error');
      setErrorMessage(
        'iCloud is not available. Check that you are signed in to iCloud and that iCloud Drive is enabled in iOS Settings.',
      );
      return;
    }

    setPhase('syncing');
    setErrorMessage('');

    try {
      const count = await deckManager.flushPending();
      await deckManager.saveRegistry();
      setFlushedCount(count);
      setPhase('done');
    } catch (e) {
      setPhase('error');
      setErrorMessage(
        e instanceof Error && e.message
          ? `Sync failed: ${e.message}`
          : 'Sync failed. Please try again.',
      );
    }
  }, [deckManager, availability]);

  return { phase, errorMessage, flushedCount, backupNow, reset };
}
