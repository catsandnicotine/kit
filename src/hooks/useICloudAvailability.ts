/**
 * useICloudAvailability — single source of truth for whether iCloud is
 * reachable on this device.
 *
 * Checks once on mount and refreshes when the app returns to the foreground,
 * because the user may toggle iCloud Drive in iOS Settings mid-session.
 */

import { useEffect, useState } from 'react';
import { isNativePlatform } from '../lib/platform/platformDetect';

export type ICloudAvailability = 'checking' | 'available' | 'unavailable';

/**
 * Hook that returns the current iCloud availability state.
 *
 * @returns 'checking' while the first probe is in flight, then 'available'
 *          or 'unavailable'. Re-probes on visibility change.
 */
export function useICloudAvailability(): ICloudAvailability {
  const [state, setState] = useState<ICloudAvailability>('checking');

  useEffect(() => {
    let cancelled = false;

    async function probe() {
      if (!isNativePlatform()) {
        if (!cancelled) setState('unavailable');
        return;
      }
      try {
        const { createICloudSyncStorage } = await import('../lib/platform/icloudSync');
        const storage = createICloudSyncStorage();
        const available = await storage.isAvailable();
        if (!cancelled) setState(available ? 'available' : 'unavailable');
      } catch {
        if (!cancelled) setState('unavailable');
      }
    }

    probe();

    const onVisibility = () => {
      if (document.visibilityState === 'visible') probe();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return state;
}
