/**
 * Hybrid Logical Clock (HLC) for edit file ordering.
 *
 * Format: `{wallMs}_{deviceId}_{counter}`
 *   - wallMs:   13-digit zero-padded millisecond timestamp
 *   - deviceId: stable per-device identifier (8 chars)
 *   - counter:  4-digit zero-padded monotonic counter per device
 *
 * Lexicographic sort of HLC strings gives correct replay order:
 *   - Same device: counter ensures strict ordering even at identical ms
 *   - Cross device: wall clock provides approximate ordering
 *
 * This module is pure logic with no platform dependencies.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Parsed HLC components. */
export interface HLCComponents {
  /** Wall-clock milliseconds. */
  wallMs: number;
  /** Device identifier. */
  deviceId: string;
  /** Monotonic counter. */
  counter: number;
}

// ---------------------------------------------------------------------------
// HLC Clock
// ---------------------------------------------------------------------------

/**
 * A Hybrid Logical Clock instance, tied to a specific device.
 *
 * Create one per device session via `createHLC(deviceId)`.
 * Call `next()` to produce the next HLC string for an edit file.
 */
export interface HLCClock {
  /** The device identifier this clock belongs to. */
  readonly deviceId: string;
  /**
   * Generate the next HLC string.
   *
   * @returns A sortable HLC string for use as an edit file identifier.
   */
  next(): string;
  /**
   * Get the current counter value (for testing/debugging).
   *
   * @returns The current monotonic counter.
   */
  counter(): number;
}

/**
 * Create a new HLC clock for a device.
 *
 * @param deviceId - Stable device identifier (will be truncated to 8 chars).
 * @returns A new HLC clock instance.
 */
export function createHLC(deviceId: string): HLCClock {
  const id = deviceId.slice(0, 8);
  let lastWallMs = 0;
  let cnt = 0;

  return {
    get deviceId() {
      return id;
    },

    next(): string {
      const now = Date.now();
      if (now === lastWallMs) {
        // Same millisecond — increment counter.
        cnt++;
      } else if (now > lastWallMs) {
        // New millisecond — reset counter.
        lastWallMs = now;
        cnt = 0;
      } else {
        // Clock went backwards — keep the last known wall time, bump counter.
        cnt++;
      }
      return formatHLC(lastWallMs, id, cnt);
    },

    counter(): number {
      return cnt;
    },
  };
}

// ---------------------------------------------------------------------------
// Formatting / Parsing
// ---------------------------------------------------------------------------

/**
 * Format HLC components into a sortable string.
 *
 * @param wallMs   - Wall-clock milliseconds.
 * @param deviceId - Device identifier (8 chars).
 * @param counter  - Monotonic counter.
 * @returns Formatted HLC string.
 */
export function formatHLC(wallMs: number, deviceId: string, counter: number): string {
  const ms = String(wallMs).padStart(13, '0');
  const cnt = String(counter).padStart(4, '0');
  return `${ms}_${deviceId}_${cnt}`;
}

/**
 * Parse an HLC string into its components.
 *
 * @param hlc - A formatted HLC string.
 * @returns Parsed components, or null if the string is malformed.
 */
export function parseHLC(hlc: string): HLCComponents | null {
  const parts = hlc.split('_');
  // Expect at least 3 parts: wallMs, deviceId (may contain underscores? no — IDs are 8 alphanum chars), counter
  // Format: {13digits}_{8chars}_{4digits}
  if (parts.length < 3) return null;

  const wallMs = parseInt(parts[0]!, 10);
  const counter = parseInt(parts[parts.length - 1]!, 10);
  // deviceId is everything between first and last underscore-separated parts
  const deviceId = parts.slice(1, -1).join('_');

  if (isNaN(wallMs) || isNaN(counter) || !deviceId) return null;

  return { wallMs, deviceId, counter };
}

/**
 * Compare two HLC strings lexicographically.
 *
 * @param a - First HLC string.
 * @param b - Second HLC string.
 * @returns Negative if a < b, positive if a > b, zero if equal.
 */
export function compareHLC(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Generate a stable 8-character device identifier.
 * Uses crypto.randomUUID() and takes the first 8 hex chars.
 *
 * @returns An 8-character alphanumeric device ID.
 */
export function generateDeviceId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 8);
}
