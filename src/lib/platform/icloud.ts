/**
 * iCloud Drive backup/sync abstraction layer.
 *
 * Native (Capacitor): calls the ICloudPlugin Swift bridge to read/write files
 *   in the app's iCloud Drive ubiquity container.
 * Browser (dev): no-ops that log to console — real iCloud requires native iOS.
 *
 * This module has ZERO imports from React or UI code.
 */

import { registerPlugin } from '@capacitor/core';
import { uint8ToBase64, base64ToUint8 } from './persistence';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Metadata written alongside each backup. */
export interface BackupMeta {
  /** Unix timestamp (seconds) of the backup. */
  timestamp: number;
  /** Total number of cards in the database at backup time. */
  cardCount: number;
  /** Human-readable device name that produced the backup. */
  deviceName: string;
  /** App version string at backup time. */
  appVersion: string;
}

/** Result from the native iCloud plugin calls. */
interface ICloudPluginInterface {
  saveBackup(options: { data: string; meta: string }): Promise<void>;
  loadBackup(): Promise<{ data: string } | null>;
  loadMeta(): Promise<{ meta: string } | null>;
  checkAvailability(): Promise<{ available: boolean }>;
}

// ---------------------------------------------------------------------------
// Plugin registration
// ---------------------------------------------------------------------------

const ICloudPlugin = registerPlugin<ICloudPluginInterface>('ICloudPlugin');

// ---------------------------------------------------------------------------
// Environment detection
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
// Public API
// ---------------------------------------------------------------------------

/**
 * Back up the database to iCloud Drive.
 *
 * @param data      - Uint8Array from Database.export().
 * @param cardCount - Total number of cards for the metadata.
 * @returns True on success, false if iCloud is unavailable.
 */
export async function backupDatabase(
  data: Uint8Array,
  cardCount: number,
): Promise<boolean> {
  if (!isNativePlatform()) {
    console.log('[icloud] backupDatabase no-op (browser mode)');
    return false;
  }

  try {
    const available = await ICloudPlugin.checkAvailability();
    if (!available.available) return false;

    const meta: BackupMeta = {
      timestamp: Math.floor(Date.now() / 1000),
      cardCount,
      deviceName: 'iOS Device',
      appVersion: '1.0.0',
    };

    await ICloudPlugin.saveBackup({
      data: uint8ToBase64(data),
      meta: JSON.stringify(meta),
    });

    return true;
  } catch {
    return false;
  }
}

/**
 * Restore the database from an iCloud Drive backup.
 *
 * @returns The raw SQLite file bytes, or null if no backup exists.
 */
export async function restoreDatabase(): Promise<Uint8Array | null> {
  if (!isNativePlatform()) {
    console.log('[icloud] restoreDatabase no-op (browser mode)');
    return null;
  }

  try {
    const result = await ICloudPlugin.loadBackup();
    if (!result?.data) return null;
    return base64ToUint8(result.data);
  } catch {
    return null;
  }
}

/**
 * Check whether an iCloud backup exists and return its metadata.
 *
 * @returns BackupMeta if a backup exists, null otherwise.
 */
export async function checkForBackup(): Promise<BackupMeta | null> {
  if (!isNativePlatform()) {
    console.log('[icloud] checkForBackup no-op (browser mode)');
    return null;
  }

  try {
    const result = await ICloudPlugin.loadMeta();
    if (!result?.meta) return null;
    return JSON.parse(result.meta) as BackupMeta;
  } catch {
    return null;
  }
}

