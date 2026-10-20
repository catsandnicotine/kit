import { useCallback, useEffect, useRef, useState } from 'react';
import type { ICloudAvailability } from './useICloudAvailability';
import type { SyncStatus } from './useSync';
import type { ConnectionNoticeState, ConnectionState } from '../types/connection';
import { updateConnectionNotice } from '../lib/connectionNotice';

/**
 * Keep one notice history across navigation and ordinary sync checks.
 * @param online - Network availability hint.
 * @param availability - Separate iCloud account availability.
 * @param status - Current sync activity.
 * @param active - Whether the home toolbar is visible.
 * @returns Visibility, presentation state, and dismissal callback.
 */
export function useConnectionNotice(online: boolean, availability: ICloudAvailability, status: SyncStatus, active: boolean) {
  const connection: ConnectionState = !online ? 'offline' : availability === 'unavailable' || status === 'error'
    ? 'paused' : availability === 'checking' ? 'checking' : 'online';
  const [notice, setNotice] = useState<ConnectionNoticeState>({ connection: 'checking', visible: false });
  const wasActive = useRef(active);
  useEffect(() => {
    setNotice(previous => {
      // Starting another background retry is not a recovery from its last failure.
      const next = status === 'syncing' && previous.connection === 'paused' && connection === 'online' ? 'checking' : connection;
      return updateConnectionNotice(previous, next);
    });
  }, [connection, status]);
  const dismiss = useCallback(() => setNotice(previous => ({ ...previous, visible: false })), []);
  useEffect(() => {
    if (wasActive.current && !active) dismiss();
    wasActive.current = active;
  }, [active, dismiss]);
  const kind: ConnectionState | 'syncing' = notice.connection === 'online' && status === 'syncing' ? 'syncing' : notice.connection;
  useEffect(() => {
    if (!active || !notice.visible || kind === 'syncing') return;
    const timer = setTimeout(dismiss, kind === 'paused' ? 6000 : 3500);
    return () => clearTimeout(timer);
  }, [active, notice.visible, kind, dismiss]);
  return { visible: notice.visible && active, kind, dismiss };
}
