import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import type { CardSeenFileStorage } from '../../types/cardSeen';
import type { MediaDirectoryHandle } from '../../types/mediaStorage';
import { atomicReadText, atomicWriteText } from './atomicWrite';
import { isNativePlatform } from './platformDetect';

const NATIVE_ROOT = 'seen-v1';
const BROWSER_ROOT = 'kit-seen-v1';
const SEGMENT = /^[A-Za-z0-9_-]+$/;
const JSON_FILE = /^[A-Za-z0-9_-]+\.json$/;

function parts(path: string, file: boolean): string[] {
  if (!file && path === '') return [];
  const result = path.split('/');
  if (path.length > 1024 || result.some((segment, index) => segment.length > 255
    || !(file && index === result.length - 1 ? JSON_FILE : SEGMENT).test(segment))) {
    throw new Error('Invalid seen-record storage path');
  }
  return result;
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

function missing(error: unknown): boolean {
  return hasCode(error, 'OS-PLUG-FILE-0008') || hasCode(error, 'ENOENT')
    || (error instanceof DOMException && error.name === 'NotFoundError');
}

function listedName(name: string, directory: boolean): string | null {
  if (directory) return SEGMENT.test(name) ? name : null;
  const canonical = name.endsWith('.json.bak') ? name.slice(0, -4) : name;
  return JSON_FILE.test(canonical) ? canonical : null;
}

async function nativeText(path: string): Promise<string | null> {
  try {
    const result = await Filesystem.readFile({ path, directory:Directory.Documents, encoding:Encoding.UTF8 });
    if (typeof result.data !== 'string') throw new Error('Seen record did not contain UTF-8 text');
    return result.data;
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
}

async function nativeRead(path: string): Promise<string | null> {
  // The shared atomic reader tolerates every read failure. Preflight strictly so
  // protected storage or a real IO failure can never masquerade as a new record.
  const canonical = await nativeText(path);
  const expected = canonical ?? await nativeText(`${path}.bak`);
  if (expected === null) return null;
  const recovered = await atomicReadText({ path, directory:Directory.Documents });
  if (recovered !== expected) throw new Error('Seen record could not be read consistently');
  return recovered;
}

async function nativeDirectory(path: string): Promise<void> {
  try {
    await Filesystem.mkdir({ path, directory:Directory.Documents, recursive:true });
  } catch (error) {
    if (!hasCode(error, 'OS-PLUG-FILE-0010')) throw error;
    const existing = await Filesystem.stat({ path, directory:Directory.Documents });
    if (existing.type !== 'directory') throw new Error('Seen-record folder is not a directory');
  }
}

async function removeNative(path: string): Promise<void> {
  try { await Filesystem.deleteFile({ path, directory:Directory.Documents }); }
  catch (error) { if (!missing(error)) throw error; }
}

async function browserDirectory(segments: string[], create = false): Promise<MediaDirectoryHandle> {
  let directory = await (await navigator.storage.getDirectory()).getDirectoryHandle(BROWSER_ROOT, { create });
  for (const segment of segments) directory = await directory.getDirectoryHandle(segment, { create });
  return directory as MediaDirectoryHandle;
}

function nativeStorage(): CardSeenFileStorage {
  return {
    async readFile(path) {
      parts(path, true);
      return await nativeRead(`${NATIVE_ROOT}/${path}`);
    },
    async writeFile(path, data) {
      const segments = parts(path, true);
      const fullPath = `${NATIVE_ROOT}/${path}`;
      const previous = await nativeRead(fullPath);
      // A readable .bak may remain when promotion fails. Never let the writer's
      // initial backup cleanup erase that last committed copy.
      if (previous !== null && await nativeText(fullPath) !== previous) {
        throw new Error('Seen-record backup must be restored before writing');
      }
      await nativeDirectory([NATIVE_ROOT, ...segments.slice(0, -1)].join('/'));
      await atomicWriteText({ path:fullPath, data, directory:Directory.Documents });
    },
    async listDirectory(path) {
      parts(path, false);
      try {
        const result = await Filesystem.readdir({ path:path ? `${NATIVE_ROOT}/${path}` : NATIVE_ROOT, directory:Directory.Documents });
        return [...new Set(result.files.flatMap(entry => {
          const name = listedName(entry.name, entry.type === 'directory');
          return name === null ? [] : [name];
        }))].sort();
      } catch (error) {
        if (missing(error)) return [];
        throw error;
      }
    },
    async deleteFile(path) {
      parts(path, true);
      const fullPath = `${NATIVE_ROOT}/${path}`;
      // Remove recovery copies first: a failed cleanup keeps the canonical file,
      // and a successful delete cannot resurrect an old backup on the next read.
      await removeNative(`${fullPath}.tmp`);
      await removeNative(`${fullPath}.bak`);
      await removeNative(fullPath);
    },
  };
}

function browserStorage(): CardSeenFileStorage {
  return {
    async readFile(path) {
      const segments = parts(path, true);
      try {
        const directory = await browserDirectory(segments.slice(0, -1));
        return await (await (await directory.getFileHandle(segments.at(-1)!)).getFile()).text();
      } catch (error) {
        if (missing(error)) return null;
        throw error;
      }
    },
    async writeFile(path, data) {
      const segments = parts(path, true);
      const directory = await browserDirectory(segments.slice(0, -1), true);
      const name = segments.at(-1)!;
      let existed = true;
      try { await directory.getFileHandle(name); }
      catch (error) { if (!missing(error)) throw error; existed = false; }
      const handle = await directory.getFileHandle(name, { create:true });
      let writer: FileSystemWritableFileStream | null = null;
      try {
        writer = await handle.createWritable();
        await writer.write(data);
        await writer.close();
      } catch (error) {
        const failures = [error];
        try { await writer?.abort(); } catch (abortError) { failures.push(abortError); }
        if (!existed) {
          try { await directory.removeEntry(name); } catch (cleanupError) { failures.push(cleanupError); }
        }
        if (failures.length > 1) throw new AggregateError(failures, 'Seen-record write and cleanup failed');
        throw error;
      }
    },
    async listDirectory(path) {
      const segments = parts(path, false);
      try {
        const names = new Set<string>();
        for await (const [entry, handle] of (await browserDirectory(segments)).entries()) {
          const name = listedName(entry, handle.kind === 'directory');
          if (name !== null) names.add(name);
        }
        return [...names].sort();
      } catch (error) {
        if (missing(error)) return [];
        throw error;
      }
    },
    async deleteFile(path) {
      const segments = parts(path, true);
      try { await (await browserDirectory(segments.slice(0, -1))).removeEntry(segments.at(-1)!); }
      catch (error) { if (!missing(error)) throw error; }
    },
  };
}

/** Create a lazy durable adapter for private per-device seen records.
 * Callers serialize writes; creating the adapter performs no filesystem IO.
 * @returns Documents/seen-v1 on native, or origin-private kit-seen-v1 in browsers.
 */
export function createCardSeenLocalStorage(): CardSeenFileStorage {
  return isNativePlatform() ? nativeStorage() : browserStorage();
}
