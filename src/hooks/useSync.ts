import { useCallback, useEffect, useRef, useState } from 'react';
import {
  startICloudWatching, stopICloudWatching, addICloudChangeListener,
} from '../lib/platform/icloudSync';
import { deckIdsFromChanges } from '../lib/sync/fileChanges';
import type { UseDeckManagerReturn } from './useDeckManager';

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error';

/** Sync activity counts completed deck checks, not bytes uploaded to Apple's servers. */
export interface UseSyncReturn {
  status: SyncStatus;
  lastSyncCount: number;
  syncError: string | null;
  lastSyncedAt: number | null;
  progress: { completed: number; total: number } | null;
  syncDeck: (deckId: string) => Promise<void>;
  syncAll: () => Promise<void>;
}

/** Replay remote edits and retry queued local work on reconnect and foreground. */
export function useSync(deckManager: UseDeckManagerReturn | null, activeDeckId?: string): UseSyncReturn {
  const [status, setStatus] = useState<SyncStatus>('idle');
  const [lastSyncCount, setLastSyncCount] = useState(0);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [progress, setProgress] = useState<{ completed: number; total: number } | null>(null);
  const managerRef = useRef(deckManager);
  const activeRef = useRef(activeDeckId);
  managerRef.current = deckManager;
  activeRef.current = activeDeckId;
  const allInFlight = useRef<Promise<void> | null>(null);
  const decksInFlight = useRef(new Map<string, Promise<void>>());
  const ready = deckManager !== null;

  const syncDeck = useCallback((deckId: string): Promise<void> => {
    const existing = decksInFlight.current.get(deckId);
    if (existing) return existing;
    const manager = managerRef.current;
    if (!manager || !navigator.onLine) return Promise.resolve();
    const task = (async () => {
      try {
        const count = await manager.sync(deckId);
        setLastSyncCount(count);
        if (count > 0) manager.refreshCounts(deckId);
      } finally {
        decksInFlight.current.delete(deckId);
      }
    })();
    decksInFlight.current.set(deckId, task);
    return task;
  }, []);

  const syncAll = useCallback((): Promise<void> => {
    if (allInFlight.current) return allInFlight.current;
    const manager = managerRef.current;
    if (!manager || !navigator.onLine) return Promise.resolve();
    const task = (async () => {
      setStatus('syncing');
      setSyncError(null);
      try {
        await manager.flushPending();
        const ids = manager.deckEntries.map(entry => entry.deckId);
        const active = activeRef.current;
        if (active && ids.includes(active)) {
          ids.splice(ids.indexOf(active), 1);
          ids.unshift(active);
        }
        setProgress({ completed: 0, total: ids.length });
        for (let index = 0; index < ids.length; index++) {
          if (!navigator.onLine) break;
          await syncDeck(ids[index]!);
          setProgress({ completed: index + 1, total: ids.length });
        }
        if (navigator.onLine) {
          // This is a local iCloud Drive check, not confirmation that another device received it.
          setLastSyncedAt(Date.now());
          setStatus('synced');
        } else setStatus('idle');
      } catch (cause) {
        setSyncError(cause instanceof Error ? cause.message : 'Sync unavailable');
        setStatus('error');
      } finally {
        setProgress(null);
        allInFlight.current = null;
      }
    })();
    allInFlight.current = task;
    return task;
  }, [syncDeck]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    let removeListener: (() => Promise<void>) | undefined;
    const setup = async () => {
      try {
        // Register before starting the native query so early changes aren't missed.
        const listener = await addICloudChangeListener(changes => {
          for (const id of deckIdsFromChanges(changes)) {
            syncDeck(id).catch(() => setSyncError('Sync unavailable'));
          }
        });
        if (cancelled) { await listener?.remove(); return; }
        removeListener = listener ? () => listener.remove() : undefined;
        await startICloudWatching('');
      } catch {
        if (!cancelled) setSyncError('iCloud unavailable');
      }
    };
    void setup();
    void syncAll();
    const retry = () => { if (document.visibilityState === 'visible') void syncAll(); };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') retry();
      else if (activeRef.current) managerRef.current?.compact(activeRef.current).catch(() => {});
    };
    window.addEventListener('online', retry);
    document.addEventListener('visibilitychange', onVisibility);
    // iCloud errors and connectivity events are not always delivered immediately.
    const timer = setInterval(retry, 30000);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener('online', retry);
      document.removeEventListener('visibilitychange', onVisibility);
      void removeListener?.();
      void stopICloudWatching().catch(() => {});
    };
  }, [ready, syncAll, syncDeck]);

  return { status, lastSyncCount, syncError, lastSyncedAt, progress, syncDeck, syncAll };
}
