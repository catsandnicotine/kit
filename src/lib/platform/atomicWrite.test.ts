/**
 * Unit tests for atomicWriteText / atomicReadText.
 *
 * A real kill-test against Capacitor on iOS requires a device harness and
 * is out of scope for Vitest. Instead, we mock Capacitor's Filesystem with
 * an in-memory store and verify the invariants that matter:
 *
 *   - A happy-path write round-trips.
 *   - Overwriting an existing file leaves no scratch files behind.
 *   - A stale `.bak` from a prior interrupted write is cleaned up.
 *   - When an interrupt leaves the filesystem in the "step 2 succeeded,
 *     step 3 didn't" state (real missing, `.bak` holds old content,
 *     `.tmp` may hold new partial content), the reader recovers via
 *     the backup so the user never observes "deck evaporated."
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// In-memory filesystem mock
// ---------------------------------------------------------------------------

let fakeFs: Map<string, string>;

vi.mock('@capacitor/filesystem', () => {
  return {
    Directory: { Documents: 'Documents' },
    Encoding: { UTF8: 'UTF8' },
    Filesystem: {
      writeFile: vi.fn(async ({ path, data }: { path: string; data: string }) => {
        fakeFs.set(path, data);
      }),
      readFile: vi.fn(async ({ path }: { path: string }) => {
        if (!fakeFs.has(path)) throw new Error('ENOENT');
        return { data: fakeFs.get(path)! };
      }),
      deleteFile: vi.fn(async ({ path }: { path: string }) => {
        if (!fakeFs.has(path)) throw new Error('ENOENT');
        fakeFs.delete(path);
      }),
      stat: vi.fn(async ({ path }: { path: string }) => {
        if (!fakeFs.has(path)) throw new Error('ENOENT');
        return { size: fakeFs.get(path)!.length };
      }),
      rename: vi.fn(async ({ from, to }: { from: string; to: string }) => {
        // Matches Capacitor's iOS semantics: throws if destination already exists.
        if (fakeFs.has(to)) throw new Error('destination exists');
        if (!fakeFs.has(from)) throw new Error('source missing');
        fakeFs.set(to, fakeFs.get(from)!);
        fakeFs.delete(from);
      }),
    },
  };
});

vi.mock('./platformDetect', () => ({
  isNativePlatform: () => true,
}));

import { atomicWriteText, atomicReadText } from './atomicWrite';
import { Directory } from '@capacitor/filesystem';

const D = Directory.Documents;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('atomicWriteText / atomicReadText', () => {
  beforeEach(() => {
    fakeFs = new Map();
  });

  test('happy-path write round-trips', async () => {
    await atomicWriteText({ path: 'x.json', data: 'hello', directory: D });
    const got = await atomicReadText({ path: 'x.json', directory: D });
    expect(got).toBe('hello');
  });

  test('overwriting an existing file leaves no scratch files behind', async () => {
    await atomicWriteText({ path: 'x.json', data: 'v1', directory: D });
    await atomicWriteText({ path: 'x.json', data: 'v2', directory: D });

    expect(await atomicReadText({ path: 'x.json', directory: D })).toBe('v2');
    expect(fakeFs.has('x.json.tmp')).toBe(false);
    expect(fakeFs.has('x.json.bak')).toBe(false);
  });

  test('stale .bak from a prior interrupted write is cleaned up on the next write', async () => {
    fakeFs.set('x.json', 'current');
    fakeFs.set('x.json.bak', 'leftover-garbage');

    await atomicWriteText({ path: 'x.json', data: 'v2', directory: D });

    expect(fakeFs.get('x.json')).toBe('v2');
    expect(fakeFs.has('x.json.bak')).toBe(false);
  });

  test('reader recovers from post-step-2 interrupt: real missing, .bak holds old data', async () => {
    // Simulate the filesystem state an interrupt can leave behind if step 2
    // (rename real → .bak) succeeded but step 3 (rename .tmp → real) did not.
    fakeFs.set('x.json.bak', 'old-but-valid');
    fakeFs.set('x.json.tmp', 'new-unfinished-data');

    const got = await atomicReadText({ path: 'x.json', directory: D });
    expect(got).toBe('old-but-valid');
    // After recovery, the canonical file should exist so subsequent reads
    // go through the fast path.
    expect(fakeFs.get('x.json')).toBe('old-but-valid');
  });

  test('reader returns null when neither real nor .bak exist', async () => {
    const got = await atomicReadText({ path: 'missing.json', directory: D });
    expect(got).toBeNull();
  });

  test('reader prefers the real file when both real and .bak exist', async () => {
    // This state corresponds to a successful step 3 that didn't get to
    // step 4 (delete .bak). The real file is the committed new value.
    fakeFs.set('x.json', 'new-committed');
    fakeFs.set('x.json.bak', 'old-still-hanging-around');

    const got = await atomicReadText({ path: 'x.json', directory: D });
    expect(got).toBe('new-committed');
  });

  test('first-time write does not require an existing file', async () => {
    // No prior real, no prior .bak — write must still succeed.
    await atomicWriteText({ path: 'new.json', data: 'first', directory: D });
    expect(fakeFs.get('new.json')).toBe('first');
  });
});
