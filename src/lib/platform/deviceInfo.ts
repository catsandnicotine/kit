/**
 * deviceInfo — authoritative device and app metadata for user-facing UI.
 *
 * Wraps @capacitor/device (for iPhone vs iPad detection) and @capacitor/app
 * (for bundle version/build). Both are read from the iOS bundle at runtime,
 * so the app never displays a hardcoded version that can drift from Xcode.
 */

import { App } from '@capacitor/app';
import { Device } from '@capacitor/device';
import { isNativePlatform } from './platformDetect';

export interface DeviceInfo {
  /** Human label for the current device, e.g. "This iPhone" or "This iPad". */
  deviceName: string;
  /** Marketing version from CFBundleShortVersionString (e.g. "1.0.1"). */
  version: string;
  /** Build number from CFBundleVersion (e.g. "3"). */
  build: string;
}

/**
 * Read device and bundle info from the native platform.
 *
 * @returns Device and app info. On web, returns safe fallbacks.
 */
export async function getDeviceInfo(): Promise<DeviceInfo> {
  if (!isNativePlatform()) {
    return { deviceName: 'This device', version: 'dev', build: '0' };
  }

  try {
    const [device, app] = await Promise.all([
      Device.getInfo(),
      App.getInfo(),
    ]);

    const deviceName = labelForModel(device.model, device.operatingSystem);
    return {
      deviceName,
      version: app.version,
      build: app.build,
    };
  } catch {
    return { deviceName: 'This device', version: 'unknown', build: '0' };
  }
}

/**
 * Map a Capacitor device model + OS to a friendly user-facing label.
 *
 * `model` on iOS returns strings like "iPhone14,2" or "iPad13,4" — enough
 * to distinguish iPhone from iPad without hardcoding specific models.
 */
function labelForModel(model: string, os: string): string {
  const lower = model.toLowerCase();
  if (lower.startsWith('ipad')) return 'This iPad';
  if (lower.startsWith('iphone')) return 'This iPhone';
  if (os === 'ios') return 'This iPhone';
  return 'This device';
}
