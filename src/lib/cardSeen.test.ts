import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCardSeenStore } from './cardSeen';
import type { CardSeenComponent, CardSeenFileStorage, CardSeenStore } from '../types/cardSeen';

function memory() {
  const files = new Map<string, string>();
  const storage: CardSeenFileStorage = {
    readFile:vi.fn(async path => files.get(path) ?? null),
    writeFile:vi.fn(async (path, data) => { files.set(path, data); }),
    listDirectory:vi.fn(async path => {
      const prefix = path ? `${path}/` : '';
      return [...new Set([...files.keys()].filter(key => key.startsWith(prefix)).map(key => key.slice(prefix.length).split('/')[0]!).filter(Boolean))];
    }),
    deleteFile:vi.fn(async path => { files.delete(path); }),
  };
  return { files, storage };
}

const stores: CardSeenStore[] = [];
function setup(local = memory(), remote?: ReturnType<typeof memory>) {
  let next = 0;
  const store = createCardSeenStore({
    deviceId:'device-a', local:local.storage, ...(remote ? { remote:remote.storage } : {}),
    debounceMs:60000, maxWaitMs:60000,
    makeSessionId:() => `11111111-1111-4111-8111-${String(++next).padStart(12, '0')}`,
  });
  stores.push(store);
  return { store, local, remote };
}
afterEach(() => { for (const store of stores.splice(0)) store.dispose(); vi.restoreAllMocks(); });

describe('durable viewing counts without scheduling writes', () => {
  it('resets only one card’s displayed count while preserving raw counts, session history and deduplication', async () => {
    const { store, local } = setup();
    const sessionId = await store.startSession({ deckId:'deck-a', mode:'study' });
    const first = { deckId:'deck-a', sessionId, cardId:'card-a', occurrenceId:'one' };
    await store.record(first);
    await store.record({ ...first, occurrenceId:'two' });
    await store.record({ ...first, cardId:'card-b', occurrenceId:'other' });
    const sessionPath = `deck-a/sessions/${sessionId}.json`;
    const beforeSession = local.files.get(sessionPath);
    const listener = vi.fn();
    store.subscribe(listener);
    vi.mocked(local.storage.writeFile).mockClear();
    expect(await store.reset({ deckId:'deck-a', cardId:'card-a' })).toEqual({ lifetime:0, session:0 });
    expect(listener).toHaveBeenCalled();
    expect(store.getStats({ ...first })).toEqual({ lifetime:0, session:2 });
    expect(store.getStats({ ...first, cardId:'card-b' })).toEqual({ lifetime:1, session:1 });
    expect(local.files.get(sessionPath)).toBe(beforeSession);
    expect(vi.mocked(local.storage.writeFile).mock.calls.some(([path]) => path.includes('/sessions/'))).toBe(false);
    expect(JSON.parse(local.files.get('deck-a/device-a.json')!).counts).toEqual({ 'card-a':2, 'card-b':1 });
    expect(await store.record(first)).toEqual({ lifetime:0, session:2 });
    expect(await store.record({ ...first, occurrenceId:'three' })).toEqual({ lifetime:1, session:3 });
    store.dispose();
    const restored = setup(local).store;
    await restored.load('deck-a');
    expect(restored.getStats(first).lifetime).toBe(1);
    expect(await restored.record(first)).toEqual({ lifetime:1, session:3 });
  });

  it('loads cached remote writers for an offline reset and preserves unseen later reveals', async () => {
    const local = memory(), remote = memory();
    local.files.set('deck-a/device-b.json', JSON.stringify({ v:1, kind:'total', deckId:'deck-a', deviceId:'device-b', counts:{ 'card-a':3 } }));
    const { store } = setup(local, remote);
    vi.mocked(remote.storage.readFile).mockRejectedValue(new Error('offline'));
    vi.mocked(remote.storage.listDirectory).mockRejectedValue(new Error('offline'));
    expect(await store.reset({ deckId:'deck-a', cardId:'card-a' })).toEqual({ lifetime:0, session:0 });
    expect(remote.storage.readFile).not.toHaveBeenCalled();
    expect(remote.storage.listDirectory).not.toHaveBeenCalled();
    vi.mocked(remote.storage.readFile).mockImplementation(async path => remote.files.get(path) ?? null);
    vi.mocked(remote.storage.listDirectory).mockImplementation(async () => ['device-b.json']);
    remote.files.set('deck-a/seen-v1/device-b.json', JSON.stringify({ v:1, kind:'total', deckId:'deck-a', deviceId:'device-b', counts:{ 'card-a':4 } }));
    await store.refresh('deck-a');
    expect(store.getStats({ deckId:'deck-a', cardId:'card-a' }).lifetime).toBe(1);
  });

  it.each(['journal', 'component', 'index', 'journal-delete'])('does not report a successful reset before the %s checkpoint is durable', async checkpoint => {
    const { store, local } = setup();
    const sessionId = await store.startSession({ deckId:'deck-a', mode:'study' });
    const input = { deckId:'deck-a', sessionId, cardId:'card-a', occurrenceId:'one' };
    await store.record(input);
    const sessionBefore = local.files.get(`deck-a/sessions/${sessionId}.json`);
    let failed = false;
    vi.mocked(local.storage.writeFile).mockImplementation(async (path, data) => {
      const target = checkpoint === 'journal' ? '_journal-device-a.json' : checkpoint === 'component' ? 'deck-a/device-a.json' : checkpoint === 'index' ? 'pending.json' : '';
      if (path === target && !failed) { failed = true; throw new Error('reset checkpoint failed'); }
      local.files.set(path, data);
    });
    vi.mocked(local.storage.deleteFile).mockImplementation(async path => {
      if (checkpoint === 'journal-delete' && path === '_journal-device-a.json' && !failed) { failed = true; throw new Error('reset checkpoint failed'); }
      local.files.delete(path);
    });
    await expect(store.reset(input)).rejects.toThrow('reset checkpoint failed');
    expect(store.getStats(input)).toEqual({ lifetime:1, session:1 });
    expect(local.files.get(`deck-a/sessions/${sessionId}.json`)).toBe(sessionBefore);
    store.dispose();
    const restored = setup(local).store;
    await restored.ready;
    await restored.load('deck-a');
    expect(restored.getStats(input).lifetime).toBe(checkpoint === 'journal' ? 1 : 0);
    if (checkpoint === 'journal') await restored.reset(input);
    expect(await restored.record(input)).toEqual({ lifetime:0, session:1 });
    expect(await restored.record({ ...input, occurrenceId:'later' })).toEqual({ lifetime:1, session:2 });
  });

  it('preserves reset baselines during an in-flight stale upload and sends the newer file next', async () => {
    const local = memory(), remote = memory();
    const { store } = setup(local, remote);
    const sessionId = await store.startSession({ deckId:'deck-a', mode:'study' });
    const input = { deckId:'deck-a', sessionId, cardId:'card-a', occurrenceId:'one' };
    await store.record(input);
    let release!: () => void;
    let entered!: () => void;
    const enteredPromise = new Promise<void>(resolve => { entered = resolve; });
    vi.mocked(remote.storage.writeFile).mockImplementationOnce(async (path, data) => {
      entered();
      await new Promise<void>(resolve => { release = resolve; });
      remote.files.set(path, data);
    });
    const uploading = store.flush();
    await enteredPromise;
    expect(await store.reset(input)).toEqual({ lifetime:0, session:0 });
    release();
    await uploading;
    expect(store.getStats(input)).toEqual({ lifetime:0, session:1 });
    expect(JSON.parse(local.files.get('pending.json')!).paths).toContain('deck-a/device-a.json');
    await store.flush();
    expect(JSON.parse(remote.files.get('deck-a/seen-v1/device-a.json')!).resets).toEqual({ 'card-a':{ 'device-a':1 } });
    expect(store.getStats(input).lifetime).toBe(0);
  });

  it('merges resets and subsequent independent reveals across two stores without deleting history', async () => {
    const remote = memory();
    const a = setup(memory(), remote).store;
    const localB = memory();
    const b = createCardSeenStore({ deviceId:'device-b', local:localB.storage, remote:remote.storage, debounceMs:60000, maxWaitMs:60000, makeSessionId:() => '22222222-2222-4222-8222-222222222222' });
    stores.push(b);
    const aSession = await a.startSession({ deckId:'deck-a', mode:'study' });
    const bSession = await b.startSession({ deckId:'deck-a', mode:'practice' });
    const first = { deckId:'deck-a', sessionId:aSession, cardId:'card-a', occurrenceId:'one' };
    await a.record(first);
    await b.record({ ...first, sessionId:bSession });
    await a.flush(); await b.flush();
    await a.refresh('deck-a');
    expect(a.getStats(first).lifetime).toBe(2);
    await a.reset(first);
    await b.record({ ...first, sessionId:bSession, occurrenceId:'offline-later' });
    await b.flush(); await a.flush();
    await a.refresh('deck-a'); await b.refresh('deck-a');
    expect(a.getStats(first)).toEqual({ lifetime:1, session:1 });
    expect(b.getStats({ ...first, sessionId:bSession })).toEqual({ lifetime:1, session:2 });
    await b.reset(first); await b.flush(); await a.refresh('deck-a');
    expect(a.getStats(first).lifetime).toBe(0);
    await a.record({ ...first, occurrenceId:'after-b-reset' });
    await a.flush(); await b.refresh('deck-a');
    expect(b.getStats({ ...first, sessionId:bSession })).toEqual({ lifetime:1, session:2 });
  });

  it('records a captured occurrence once, keeps sessions separate, and reloads lifetime offline', async () => {
    const { store, local } = setup();
    const first = await store.startSession({ deckId:'deck-a', mode:'study' });
    const occurrence = { deckId:'deck-a', sessionId:first, cardId:'card-a', occurrenceId:'first:0' };
    const results = await Promise.all([store.record(occurrence), store.record(occurrence), store.record(occurrence)]);
    expect(results).toEqual(Array(3).fill({ lifetime:1, session:1 }));
    expect(await store.record({ ...occurrence, occurrenceId:'repeat:1' })).toEqual({ lifetime:2, session:2 });
    const second = await store.startSession({ deckId:'deck-a', mode:'practice' });
    expect(await store.record({ ...occurrence, sessionId:second })).toEqual({ lifetime:3, session:1 });
    expect(JSON.parse(local.files.get(`deck-a/sessions/${second}.json`)!).mode).toBe('practice');
    store.dispose();
    const restored = setup(local).store;
    await restored.load('deck-a');
    expect(restored.getStats({ deckId:'deck-a', cardId:'card-a' })).toEqual({ lifetime:3, session:0 });
    expect(await restored.record(occurrence)).toEqual({ lifetime:3, session:2 });
    expect([...local.files.keys()].every(path => !path.includes('snapshot') && !path.includes('edits'))).toBe(true);
  });

  it('does not read or rewrite historical session files during a new occurrence', async () => {
    const { store, local } = setup();
    const old = await store.startSession({ deckId:'deck-a', mode:'study' });
    await store.record({ deckId:'deck-a', sessionId:old, cardId:'card-a', occurrenceId:'old' });
    const current = await store.startSession({ deckId:'deck-a', mode:'practice' });
    vi.mocked(local.storage.readFile).mockClear();
    vi.mocked(local.storage.writeFile).mockClear();
    await store.record({ deckId:'deck-a', sessionId:current, cardId:'card-a', occurrenceId:'current' });
    expect(vi.mocked(local.storage.readFile).mock.calls.some(([path]) => path.includes(old))).toBe(false);
    expect(vi.mocked(local.storage.writeFile).mock.calls.some(([path]) => path.includes(old))).toBe(false);
  });

  it('keeps durable totals when cloud upload fails, then retries after local reload', async () => {
    const local = memory(), remote = memory();
    const { store } = setup(local, remote);
    const id = await store.startSession({ deckId:'deck-a', mode:'study' });
    vi.mocked(remote.storage.writeFile).mockRejectedValueOnce(new Error('offline'));
    expect(await store.record({ deckId:'deck-a', sessionId:id, cardId:'card-a', occurrenceId:'one' })).toEqual({ lifetime:1, session:1 });
    await expect(store.flush()).rejects.toThrow('offline');
    expect(store.getStats({ deckId:'deck-a', cardId:'card-a', sessionId:id })).toEqual({ lifetime:1, session:1 });
    expect(JSON.parse(local.files.get('pending.json')!).paths).toHaveLength(2);
    store.dispose();
    const restored = setup(local, remote).store;
    await restored.flush();
    expect(remote.files.has('deck-a/seen-v1/device-a.json')).toBe(true);
    expect(remote.files.has(`deck-a/seen-v1/sessions/${id}.json`)).toBe(true);
    expect(JSON.parse(local.files.get('pending.json')!).paths).toEqual([]);
  });

  it('merges independent offline devices with MAX, including reordered or missing cloud files', async () => {
    const local = memory(), remote = memory();
    const component: CardSeenComponent = { v:1, kind:'total', deckId:'deck-a', deviceId:'device-b', counts:{ 'card-a':3 } };
    remote.files.set('deck-a/seen-v1/device-b.json', JSON.stringify(component));
    const { store } = setup(local, remote);
    const sessionId = await store.startSession({ deckId:'deck-a', mode:'practice' });
    await store.record({ deckId:'deck-a', sessionId, cardId:'card-a', occurrenceId:'one' });
    await store.refresh('deck-a');
    expect(store.getStats({ deckId:'deck-a', cardId:'card-a', sessionId })).toEqual({ lifetime:4, session:1 });
    remote.files.set('deck-a/seen-v1/device-b.json', JSON.stringify({ ...component, counts:{ 'card-a':1 } }));
    await store.handleChanges([{ path:'deck-a/seen-v1/device-b.json', event:'changed' }], 'deck-a');
    remote.files.delete('deck-a/seen-v1/device-b.json');
    await store.refresh('deck-a');
    expect(store.getStats({ deckId:'deck-a', cardId:'card-a', sessionId })).toEqual({ lifetime:4, session:1 });
    expect(vi.mocked(remote.storage.listDirectory).mock.calls.every(([path]) => !path.includes('sessions'))).toBe(true);
  });

  it('recovers the lifetime/session pair after a partial local transaction, without counting its retry twice', async () => {
    const local = memory();
    const { store } = setup(local);
    const sessionId = await store.startSession({ deckId:'deck-a', mode:'study' });
    const occurrence = { deckId:'deck-a', sessionId, cardId:'card-a', occurrenceId:'one' };
    const write = local.storage.writeFile;
    let failed = false;
    vi.mocked(write).mockImplementation(async (path, data) => {
      if (path === 'deck-a/device-a.json' && !failed) { failed = true; throw new Error('storage locked'); }
      local.files.set(path, data);
    });
    await expect(store.record(occurrence)).rejects.toThrow('storage locked');
    expect(local.files.has('_journal-device-a.json')).toBe(true);
    expect(store.getStats({ deckId:'deck-a', cardId:'card-a' }).lifetime).toBe(0);
    store.dispose();
    const restored = setup(local).store;
    await restored.ready;
    expect(await restored.record(occurrence)).toEqual({ lifetime:1, session:1 });
    expect(local.files.has('_journal-device-a.json')).toBe(false);
  });

  it('retries a transient initialization failure on the next action without erasing local data', async () => {
    const local = memory();
    local.files.set('deck-a/device-a.json', JSON.stringify({ v:1, kind:'total', deckId:'deck-a', deviceId:'device-a', counts:{ 'card-a':5 } }));
    vi.mocked(local.storage.readFile).mockRejectedValueOnce(new Error('protected data'));
    const { store } = setup(local);
    await expect(store.ready).rejects.toThrow('protected data');
    await store.load('deck-a');
    expect(store.getStats({ deckId:'deck-a', cardId:'card-a' })).toEqual({ lifetime:5, session:0 });
    expect(local.storage.writeFile).not.toHaveBeenCalled();
  });

  it.each(['session', 'component', 'index', 'journal-delete'])('repairs a failed %s checkpoint before the same or next occurrence', async checkpoint => {
    const local = memory();
    const { store } = setup(local);
    const sessionId = await store.startSession({ deckId:'deck-a', mode:'study' });
    const occurrence = { deckId:'deck-a', sessionId, cardId:'card-a', occurrenceId:'one' };
    let failed = false;
    vi.mocked(local.storage.writeFile).mockImplementation(async (path, data) => {
      const target = checkpoint === 'session' ? `deck-a/sessions/${sessionId}.json` : checkpoint === 'component' ? 'deck-a/device-a.json' : checkpoint === 'index' ? 'pending.json' : '';
      if (path === target && !failed) { failed = true; throw new Error('checkpoint failed'); }
      local.files.set(path, data);
    });
    vi.mocked(local.storage.deleteFile).mockImplementation(async path => {
      if (checkpoint === 'journal-delete' && path === '_journal-device-a.json' && !failed) { failed = true; throw new Error('checkpoint failed'); }
      local.files.delete(path);
    });
    await expect(store.record(occurrence)).rejects.toThrow('checkpoint failed');
    expect(await store.record(occurrence)).toEqual({ lifetime:1, session:1 });
    expect(await store.record({ ...occurrence, occurrenceId:'two' })).toEqual({ lifetime:2, session:2 });
    expect(local.files.has('_journal-device-a.json')).toBe(false);
  });

  it('rejects a failed journal write without inventing a durable increment', async () => {
    const { store, local } = setup();
    const sessionId = await store.startSession({ deckId:'deck-a', mode:'practice' });
    const occurrence = { deckId:'deck-a', sessionId, cardId:'card-a', occurrenceId:'one' };
    const before = new Map(local.files);
    vi.mocked(local.storage.writeFile).mockRejectedValueOnce(new Error('disk full'));
    await expect(store.record(occurrence)).rejects.toThrow('disk full');
    expect(local.files).toEqual(before);
    expect(store.getStats({ deckId:'deck-a', cardId:'card-a', sessionId })).toEqual({ lifetime:0, session:0 });
    expect(await store.record(occurrence)).toEqual({ lifetime:1, session:1 });
  });

  it('refuses malformed/foreign data and prototype keys without overwriting files', async () => {
    const { store, local } = setup();
    const sessionId = await store.startSession({ deckId:'deck-a', mode:'practice' });
    const before = new Map(local.files);
    for (const key of ['constructor', 'toString', '__proto__']) {
      await expect(store.record({ deckId:'deck-a', sessionId, cardId:'card-a', occurrenceId:key })).rejects.toThrow();
      await expect(store.record({ deckId:'deck-a', sessionId, cardId:key, occurrenceId:'one' })).rejects.toThrow();
    }
    await expect(store.record({ deckId:'deck-b', sessionId, cardId:'card-a', occurrenceId:'one' })).rejects.toThrow();
    expect(local.files).toEqual(before);
    local.files.set('deck-c/device-b.json', JSON.stringify({ v:1, kind:'total', deckId:'foreign', deviceId:'device-b', counts:{ 'card-a':10 } }));
    await expect(store.load('deck-c')).rejects.toThrow();
    expect(local.files.get('deck-c/device-b.json')).toContain('foreign');
  });

  it('does not block a new local record behind an in-flight cloud write or clear its newer dirty state', async () => {
    const local = memory(), remote = memory();
    const { store } = setup(local, remote);
    const sessionId = await store.startSession({ deckId:'deck-a', mode:'study' });
    const first = { deckId:'deck-a', sessionId, cardId:'card-a', occurrenceId:'one' };
    await store.record(first);
    let release: (() => void) | undefined;
    let entered: (() => void) | undefined;
    const enteredPromise = new Promise<void>(resolve => { entered = resolve; });
    vi.mocked(remote.storage.writeFile).mockImplementationOnce(async (path, data) => {
      entered?.();
      await new Promise<void>(resolve => { release = resolve; });
      remote.files.set(path, data);
    });
    const uploading = store.flush();
    await enteredPromise;
    expect(await store.record({ ...first, occurrenceId:'two' })).toEqual({ lifetime:2, session:2 });
    release?.();
    await uploading;
    expect(JSON.parse(local.files.get('pending.json')!).paths).toContain('deck-a/device-a.json');
    await store.flush();
    expect(JSON.parse(remote.files.get('deck-a/seen-v1/device-a.json')!).counts['card-a']).toBe(2);
    expect(store.getStats({ deckId:'deck-a', cardId:'card-a', sessionId })).toEqual({ lifetime:2, session:2 });
  });

  it('preserves a larger remote own component before upload, and does not read unrelated decks on change', async () => {
    const remote = memory();
    const { store } = setup(memory(), remote);
    const sessionId = await store.startSession({ deckId:'deck-a', mode:'study' });
    await store.record({ deckId:'deck-a', sessionId, cardId:'card-a', occurrenceId:'one' });
    remote.files.set('deck-a/seen-v1/device-a.json', JSON.stringify({ v:1, kind:'total', deckId:'deck-a', deviceId:'device-a', counts:{ 'card-a':5 } }));
    await store.flush();
    expect(JSON.parse(remote.files.get('deck-a/seen-v1/device-a.json')!).counts['card-a']).toBe(5);
    vi.mocked(remote.storage.readFile).mockClear();
    await store.handleChanges([{ path:'other/seen-v1/device-b.json', event:'changed' }, { path:'deck-a/snapshot.json', event:'changed' }], 'deck-a');
    expect(remote.storage.readFile).not.toHaveBeenCalled();
  });
});
