/**
 * useDeviceInfo — reactively exposes device and app info for UI copy.
 *
 * Reads once on mount. Values come from the iOS bundle (via @capacitor/app)
 * and the native device (via @capacitor/device), so they always reflect
 * what Xcode actually shipped.
 */

import { useEffect, useState } from 'react';
import { getDeviceInfo, type DeviceInfo } from '../lib/platform/deviceInfo';

const FALLBACK: DeviceInfo = { deviceName: 'This device', version: '—', build: '—' };

export function useDeviceInfo(): DeviceInfo {
  const [info, setInfo] = useState<DeviceInfo>(FALLBACK);

  useEffect(() => {
    let cancelled = false;
    getDeviceInfo().then(result => {
      if (!cancelled) setInfo(result);
    });
    return () => { cancelled = true; };
  }, []);

  return info;
}
