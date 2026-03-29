import { useCallback, useEffect, useRef, useState } from 'react';
import type { PluginListenerHandle } from '@capacitor/core';
import {
  startICloudWatching,
  stopICloudWatching,
  addICloudChangeListener,
} from '../lib/platform/icloudSync';
import type { ICloudFileChange } from '../lib/platform/icloudSync';
import type { UseDeckManagerReturn } from './useDeckManager';

/** Sync status for UI display. */
export type SyncStatus = 'idle' | 'syncing' | 'synced';

/** How long the "synced" badge stays visible before reverting to idle. */
const SYNCED_DISPLAY_MS = 3000;

/** Minimum interval between sync attempts for the same deck (ms). */
const SYNC_THROTTLE_MS = 2000;

export interface UseSyncReturn {
  /** Current sync status for UI indicator. */
  status: SyncStatus;
  /** Number of edits applied in the most recent sync. */
  lastSyncCount: number;
  /** Manually trigger a sync for a specific deck. */
  syncDeck: (deckId: string) => Promise<void>;
}

/** Extract deck IDs from edit file paths. */
function extractDeckIds(changes: ICloudFileChange[]): string[] {
  const ids = new Set<string>();
  for (const change of changes) {
    // Edit files live at: {deckId}/edits/{hlc}.json
    const match = change.path.match(/^([^/]+)\/edits\//);
    if (match && (change.event === 'added' || change.event === 'changed')) {
      ids.add(match[1]!);
    }
  }
  return Array.from(ids);
}

/**
 * Hook that listens for iCloud file change events and auto-syncs affected decks.
 *
 * @param deckManager - The deck manager instance (null while loading).
 * @param activeDeckId - Currently open deck ID (if any) — prioritised for sync.
 * @returns Sync status and manual sync trigger.
 */
export function useSync(
  deckManager: UseDeckManagerReturn | null,
  activeDeckId?: string,
): UseSyncReturn {
  const [status, setStatus] = useState<SyncStatus>('idle');
  const [lastSyncCount, setLastSyncCount] = useState(0);

  const listenerRef = useRef<PluginListenerHandle | null>(null);
  const syncedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSyncTimeRef = useRef<Map<string, number>>(new Map());

  // Stable refs so the iCloud watcher effect doesn't tear down on every navigation
  const deckManagerRef = useRef(deckManager);
  deckManagerRef.current = deckManager;
  const activeDeckIdRef = useRef(activeDeckId);
  activeDeckIdRef.current = activeDeckId;

  // ── Sync a single deck with throttling ────────────────────────────────
  const syncDeck = useCallback(async (deckId: string) => {
    const dm = deckManagerRef.current;
    if (!dm) return;

    const now = Date.now();
    const lastSync = lastSyncTimeRef.current.get(deckId) ?? 0;
    if (now - lastSync < SYNC_THROTTLE_MS) return;
    lastSyncTimeRef.current.set(deckId, now);

    setStatus('syncing');
    try {
      const count = await dm.sync(deckId);
      setLastSyncCount(count);

      if (count > 0) {
        dm.refreshCounts(deckId);
        setStatus('synced');
        if (syncedTimerRef.current) clearTimeout(syncedTimerRef.current);
        syncedTimerRef.current = setTimeout(() => setStatus('idle'), SYNCED_DISPLAY_MS);
      } else {
        setStatus('idle');
      }
    } catch {
      setStatus('idle');
    }
  }, []);

  // ── Handle incoming file change events ────────────────────────────────
  const handleChanges = useCallback(
    async (changes: ICloudFileChange[]) => {
      const deckIds = extractDeckIds(changes);
      if (deckIds.length === 0) return;

      const active = activeDeckIdRef.current;

      // Sync the active deck first (most visible to the user)
      if (active && deckIds.includes(active)) {
        await syncDeck(active);
      }

      // Sync other changed decks in parallel
      const others = deckIds.filter(id => id !== active);
      if (others.length > 0) {
        await Promise.all(others.map(id => syncDeck(id)));
      }
    },
    [syncDeck],
  );

  // ── Start/stop watching on mount/unmount ──────────────────────────────
  // Only depends on deckManager identity (not activeDeckId) to avoid
  // tearing down the native NSMetadataQuery watcher on every navigation.
  useEffect(() => {
    if (!deckManager) return;

    let cancelled = false;

    const setup = async () => {
      try {
        await startICloudWatching('');
        if (cancelled) return;

        const handle = await addICloudChangeListener(handleChanges);
        if (cancelled) {
          if (handle) handle.remove();
          return;
        }
        listenerRef.current = handle;
      } catch {
        // Non-native platform or iCloud unavailable — stay idle
      }
    };

    setup();

    return () => {
      cancelled = true;
      if (listenerRef.current) {
        listenerRef.current.remove();
        listenerRef.current = null;
      }
      stopICloudWatching().catch(() => {});
      if (syncedTimerRef.current) {
        clearTimeout(syncedTimerRef.current);
        syncedTimerRef.current = null;
      }
    };
  }, [deckManager, handleChanges]);

  // ── Sync/save active deck on visibility changes ───────────────────────
  useEffect(() => {
    if (!activeDeckId || !deckManager) return;

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        deckManager.flushPending().catch(() => {});
        syncDeck(activeDeckId);
      } else {
        // App going to background — snapshot current state locally so a
        // force-kill doesn't lose the session's edits on next open.
        deckManager.compact(activeDeckId).catch(() => {});
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [activeDeckId, deckManager, syncDeck]);

  return { status, lastSyncCount, syncDeck };
}
