/**
 * Database persistence — save/load the sql.js in-memory database to durable storage.
 *
 * Strategy:
 *  - Native (Capacitor): @capacitor/filesystem → Documents/kit.db
 *  - Browser (dev mode):  localStorage base64-encoded snapshot
 *
 * The sql.js Database.export() returns a Uint8Array of the full SQLite file.
 * On startup, if a snapshot exists, it is loaded into a new Database instance
 * instead of creating an empty one.
 *
 * This module lives in lib/platform/ per the separation-of-concerns rules.
 * It has ZERO imports from React or UI code.
 */

import { Filesystem, Directory } from '@capacitor/filesystem';

const DB_FILENAME = 'kit.db';
const LS_KEY = 'kit_db_snapshot';

// ---------------------------------------------------------------------------
// Environment detection
// ---------------------------------------------------------------------------

/**
 * Check if we're running on a native Capacitor platform (iOS/Android).
 * When native, we use the Filesystem plugin; otherwise we fall back to
 * localStorage for browser dev mode.
 */
function isNativePlatform(): boolean {
  try {
    // Capacitor sets window.Capacitor.isNativePlatform on native builds.
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
 * Save a database snapshot to durable storage.
 *
 * @param data - Uint8Array from Database.export().
 */
export async function saveDatabaseSnapshot(data: Uint8Array): Promise<void> {
  if (isNativePlatform()) {
    await saveNative(data);
  } else {
    saveBrowser(data);
  }
}

/**
 * Load a previously-saved database snapshot, or null if none exists.
 *
 * @returns The raw SQLite file bytes, or null.
 */
export async function loadDatabaseSnapshot(): Promise<Uint8Array | null> {
  if (isNativePlatform()) {
    return loadNative();
  }
  return loadBrowser();
}

// ---------------------------------------------------------------------------
// Native (Capacitor Filesystem)
// ---------------------------------------------------------------------------

async function saveNative(data: Uint8Array): Promise<void> {
  // Filesystem.writeFile with Encoding.UTF8 won't work for binary.
  // Convert to base64 and write as a data URI-less base64 string.
  const base64 = uint8ToBase64(data);
  await Filesystem.writeFile({
    path: DB_FILENAME,
    data: base64,
    directory: Directory.Documents,
  });
}

async function loadNative(): Promise<Uint8Array | null> {
  try {
    const result = await Filesystem.readFile({
      path: DB_FILENAME,
      directory: Directory.Documents,
    });
    if (typeof result.data === 'string') {
      return base64ToUint8(result.data);
    }
    // Blob result (web implementation)
    if (result.data instanceof Blob) {
      const buffer = await result.data.arrayBuffer();
      return new Uint8Array(buffer);
    }
    return null;
  } catch {
    // File doesn't exist yet — first launch.
    return null;
  }
}

// ---------------------------------------------------------------------------
// Browser (localStorage — dev mode only)
// ---------------------------------------------------------------------------

function saveBrowser(data: Uint8Array): void {
  if (data.byteLength > LS_MAX_BYTES) {
    // Skip — encoding + storing would freeze the main thread and exceed
    // the localStorage quota anyway (~5–10 MB).
    console.warn(
      `[persistence] DB snapshot is ${(data.byteLength / 1024 / 1024).toFixed(1)} MB — ` +
      'too large for localStorage. Skipping browser persist.',
    );
    return;
  }
  try {
    const base64 = uint8ToBase64(data);
    localStorage.setItem(LS_KEY, base64);
  } catch {
    // localStorage full or unavailable — log but don't crash.
    console.warn('[persistence] Failed to save DB snapshot to localStorage (storage may be full).');
  }
}

function loadBrowser(): Uint8Array | null {
  try {
    const base64 = localStorage.getItem(LS_KEY);
    if (!base64) return null;
    return base64ToUint8(base64);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Base64 helpers
// ---------------------------------------------------------------------------

/** Max snapshot size we'll attempt to store in localStorage (4 MB). */
const LS_MAX_BYTES = 4 * 1024 * 1024;

/**
 * Convert a Uint8Array to a base64 string.
 *
 * Uses chunked String.fromCharCode to avoid O(n²) string concatenation
 * and call-stack limits. For a 10 MB database this completes in ~50 ms
 * instead of 10+ seconds.
 *
 * @param bytes - Raw bytes to encode.
 * @returns Base64 string.
 */
function uint8ToBase64(bytes: Uint8Array): string {
  const CHUNK = 8192;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
    parts.push(String.fromCharCode.apply(null, slice as unknown as number[]));
  }
  return btoa(parts.join(''));
}

/**
 * Convert a base64 string back to a Uint8Array.
 *
 * @param base64 - Base64-encoded string.
 * @returns Decoded bytes.
 */
function base64ToUint8(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
