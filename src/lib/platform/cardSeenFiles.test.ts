import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Filesystem } from '@capacitor/filesystem';
import { createCardSeenLocalStorage } from './cardSeenFiles';

const state = vi.hoisted(() => ({
  native:true,
  files:new Map<string, string>(),
  directories:new Set<string>(),
  failures:new Map<string, unknown>(),
}));

vi.mock('./platformDetect', () => ({ isNativePlatform:() => state.native }));
vi.mock('@capacitor/filesystem', () => {
  const absent = () => ({ code:'OS-PLUG-FILE-0008' });
  const check = (operation: string, path: string) => {
    const failure = state.failures.get(`${operation}:${path}`);
    if (failure) throw failure;
  };
  return {
    Directory:{ Documents:'DOCUMENTS' }, Encoding:{ UTF8:'utf8' },
    Filesystem:{
      readFile:vi.fn(async ({ path }: { path: string }) => {
        check('read', path);
        if (!state.files.has(path)) throw absent();
        return { data:state.files.get(path)! };
      }),
      writeFile:vi.fn(async ({ path, data }: { path: string; data: string }) => {
        check('write', path); state.files.set(path, data);
      }),
      stat:vi.fn(async ({ path }: { path: string }) => {
        check('stat', path);
        if (state.directories.has(path)) return { type:'directory' };
        if (state.files.has(path)) return { type:'file' };
        throw absent();
      }),
      mkdir:vi.fn(async ({ path }: { path: string }) => {
        check('mkdir', path);
        if (state.directories.has(path)) throw { code:'OS-PLUG-FILE-0010' };
        const segments = path.split('/');
        for (let count = 1; count <= segments.length; count++) state.directories.add(segments.slice(0, count).join('/'));
      }),
      rename:vi.fn(async ({ from, to }: { from: string; to: string }) => {
        check('rename', from);
        if (!state.files.has(from)) throw absent();
        if (state.files.has(to)) throw new Error('Destination exists');
        state.files.set(to, state.files.get(from)!); state.files.delete(from);
      }),
      deleteFile:vi.fn(async ({ path }: { path: string }) => {
        check('delete', path);
        if (!state.files.delete(path)) throw absent();
      }),
      readdir:vi.fn(async ({ path }: { path: string }) => {
        check('list', path);
        if (!state.directories.has(path)) throw absent();
        const prefix = `${path}/`;
        const files = [...state.files.keys()].filter(name => name.startsWith(prefix) && !name.slice(prefix.length).includes('/'))
          .map(name => ({ name:name.slice(prefix.length), type:'file' }));
        const directories = [...state.directories].filter(name => name.startsWith(prefix) && !name.slice(prefix.length).includes('/'))
          .map(name => ({ name:name.slice(prefix.length), type:'directory' }));
        return { files:[...files, ...directories] };
      }),
    },
  };
});

class BrowserFile {
  readonly kind = 'file';
  readonly name: string;
  data = '';
  writeError: Error | null = null;
  abort = vi.fn(async () => {});
  constructor(name: string) { this.name = name; }
  async getFile() { return new File([this.data], this.name); }
  async createWritable() {
    let pending = '';
    return {
      write:async (data: string) => { if (this.writeError) throw this.writeError; pending = data; },
      close:async () => { this.data = pending; },
      abort:this.abort,
    };
  }
}

class BrowserDirectory {
  readonly kind = 'directory';
  readonly name: string;
  children = new Map<string, BrowserDirectory | BrowserFile>();
  getError: Error | null = null;
  constructor(name: string) { this.name = name; }
  async getDirectoryHandle(name: string, options?: { create?: boolean }) {
    if (this.getError) throw this.getError;
    if (!this.children.has(name) && options?.create) this.children.set(name, new BrowserDirectory(name));
    const result = this.children.get(name);
    if (!result) throw new DOMException('Missing', 'NotFoundError');
    if (result.kind !== 'directory') throw new DOMException('Not a directory', 'TypeMismatchError');
    return result;
  }
  async getFileHandle(name: string, options?: { create?: boolean }) {
    if (this.getError) throw this.getError;
    if (!this.children.has(name) && options?.create) this.children.set(name, new BrowserFile(name));
    const result = this.children.get(name);
    if (!result) throw new DOMException('Missing', 'NotFoundError');
    if (result.kind !== 'file') throw new DOMException('Not a file', 'TypeMismatchError');
    return result;
  }
  async removeEntry(name: string) {
    if (!this.children.delete(name)) throw new DOMException('Missing', 'NotFoundError');
  }
  async *entries() { yield* this.children.entries(); }
}

beforeEach(() => {
  vi.clearAllMocks();
  state.native = true; state.files.clear(); state.directories.clear(); state.failures.clear();
});
afterEach(() => vi.unstubAllGlobals());

describe('private native seen-record files', () => {
  it('does no IO at creation and atomically round-trips nested records', async () => {
    const storage = createCardSeenLocalStorage();
    expect(Filesystem.readFile).not.toHaveBeenCalled();
    expect(Filesystem.mkdir).not.toHaveBeenCalled();
    await storage.writeFile('deck-a/sessions/session_1.json', '{"seen":2}');
    await storage.writeFile('deck-a/sessions/session_1.json', '{"seen":3}');
    expect(await storage.readFile('deck-a/sessions/session_1.json')).toBe('{"seen":3}');
    expect([...state.files.keys()]).toEqual(['seen-v1/deck-a/sessions/session_1.json']);
  });

  it('returns missing only for explicit not-found errors', async () => {
    const storage = createCardSeenLocalStorage();
    expect(await storage.readFile('pending.json')).toBeNull();
    expect(await storage.listDirectory('')).toEqual([]);
    const failure = { code:'OS-PLUG-FILE-0013', message:'Protected storage unavailable' };
    state.failures.set('read:seen-v1/pending.json', failure);
    state.files.set('seen-v1/pending.json.bak', 'old');
    await expect(storage.readFile('pending.json')).rejects.toBe(failure);
    await expect(storage.writeFile('pending.json', 'new')).rejects.toBe(failure);
    expect(state.files.get('seen-v1/pending.json.bak')).toBe('old');
    state.failures.set('list:seen-v1', failure);
    await expect(storage.listDirectory('')).rejects.toBe(failure);
  });

  it('restores the last committed backup and exposes its logical name in listings', async () => {
    state.directories.add('seen-v1');
    state.directories.add('seen-v1/deck-a');
    state.files.set('seen-v1/pending.json.bak', 'committed');
    state.files.set('seen-v1/pending.json.tmp', 'partial');
    state.files.set('seen-v1/ignored.txt', 'unrelated');
    const storage = createCardSeenLocalStorage();
    expect(await storage.listDirectory('')).toEqual(['deck-a', 'pending.json']);
    expect(await storage.readFile('pending.json')).toBe('committed');
    expect(state.files.get('seen-v1/pending.json')).toBe('committed');
  });

  it('never erases a readable backup when its promotion is blocked', async () => {
    state.files.set('seen-v1/pending.json.bak', 'committed');
    state.failures.set('rename:seen-v1/pending.json.bak', new Error('Protected storage'));
    const storage = createCardSeenLocalStorage();
    expect(await storage.readFile('pending.json')).toBe('committed');
    await expect(storage.writeFile('pending.json', 'replacement')).rejects.toThrow('backup must be restored');
    expect(state.files.get('seen-v1/pending.json.bak')).toBe('committed');
    expect(Filesystem.writeFile).not.toHaveBeenCalled();
  });

  it('keeps the prior committed record when replacement fails', async () => {
    state.files.set('seen-v1/pending.json', 'committed');
    state.failures.set('rename:seen-v1/pending.json.tmp', new Error('Disk failure'));
    const storage = createCardSeenLocalStorage();
    await expect(storage.writeFile('pending.json', 'replacement')).rejects.toThrow('Disk failure');
    expect(await storage.readFile('pending.json')).toBe('committed');
  });

  it('deletes recovery copies before the canonical file and is idempotent', async () => {
    for (const suffix of ['', '.bak', '.tmp']) state.files.set(`seen-v1/pending.json${suffix}`, 'data');
    const storage = createCardSeenLocalStorage();
    await storage.deleteFile('pending.json');
    await storage.deleteFile('pending.json');
    expect(await storage.readFile('pending.json')).toBeNull();
    expect([...state.files]).toEqual([]);
  });

  it('leaves the canonical record intact if deleting its backup fails', async () => {
    state.files.set('seen-v1/pending.json', 'committed');
    state.files.set('seen-v1/pending.json.bak', 'older');
    state.failures.set('delete:seen-v1/pending.json.bak', new Error('IO failure'));
    await expect(createCardSeenLocalStorage().deleteFile('pending.json')).rejects.toThrow('IO failure');
    expect(state.files.get('seen-v1/pending.json')).toBe('committed');
  });

  it('rejects traversal, empty file names and unapproved path characters before IO', async () => {
    const storage = createCardSeenLocalStorage();
    for (const path of ['', '../pending.json', '/pending.json', 'a//b.json', 'a%2fb.json', 'a.json.bak', 'a/b.txt', 'a/./b.json']) {
      await expect(storage.readFile(path)).rejects.toThrow('Invalid');
      await expect(storage.writeFile(path, '{}')).rejects.toThrow('Invalid');
      await expect(storage.deleteFile(path)).rejects.toThrow('Invalid');
    }
    await expect(storage.listDirectory('../')).rejects.toThrow('Invalid');
    expect(Filesystem.readFile).not.toHaveBeenCalled();
    expect(Filesystem.mkdir).not.toHaveBeenCalled();
  });
});

describe('origin-private browser seen-record files', () => {
  let root: BrowserDirectory;
  beforeEach(() => {
    state.native = false; root = new BrowserDirectory('root');
    vi.stubGlobal('navigator', { storage:{ getDirectory:vi.fn(async () => root) } });
  });

  it('creates the dedicated root lazily, round-trips and enumerates immediate entries', async () => {
    const storage = createCardSeenLocalStorage();
    expect(root.children.size).toBe(0);
    expect(await storage.readFile('pending.json')).toBeNull();
    expect(await storage.listDirectory('')).toEqual([]);
    await storage.writeFile('deck-a/device_a.json', 'first');
    await storage.writeFile('pending.json', '{}');
    await storage.writeFile('deck-a/device_a.json', 'second');
    expect(await storage.readFile('deck-a/device_a.json')).toBe('second');
    expect(await storage.listDirectory('')).toEqual(['deck-a', 'pending.json']);
    expect(await storage.listDirectory('deck-a')).toEqual(['device_a.json']);
    await storage.deleteFile('deck-a/device_a.json');
    await storage.deleteFile('deck-a/device_a.json');
    expect(await storage.readFile('deck-a/device_a.json')).toBeNull();
    expect(Filesystem.readFile).not.toHaveBeenCalled();
  });

  it('propagates storage errors without resetting a record', async () => {
    const error = new DOMException('Storage denied', 'SecurityError'); root.getError = error;
    const storage = createCardSeenLocalStorage();
    await expect(storage.readFile('pending.json')).rejects.toBe(error);
    await expect(storage.listDirectory('')).rejects.toBe(error);
    await expect(storage.writeFile('pending.json', '{}')).rejects.toBe(error);
    await expect(storage.deleteFile('pending.json')).rejects.toBe(error);
  });

  it('aborts a failed replacement without deleting prior committed data', async () => {
    const storage = createCardSeenLocalStorage();
    await storage.writeFile('pending.json', 'committed');
    const directory = await root.getDirectoryHandle('kit-seen-v1');
    const file = await directory.getFileHandle('pending.json');
    file.writeError = new Error('Quota exceeded');
    await expect(storage.writeFile('pending.json', 'replacement')).rejects.toThrow('Quota exceeded');
    expect(file.abort).toHaveBeenCalledOnce();
    expect(await storage.readFile('pending.json')).toBe('committed');
  });
});
