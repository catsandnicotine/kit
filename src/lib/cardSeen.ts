import { v4 as uuidv4 } from 'uuid';
import type { CardSeenComponent, CardSeenConfig, CardSeenFileChange, CardSeenJournal, CardSeenRecordInput, CardSeenRemotePath, CardSeenResetInput, CardSeenSession, CardSeenSessionInput, CardSeenStats, CardSeenStatsInput, CardSeenStore } from '../types/cardSeen';
import { cardSeenCloudPath, cardSeenRemotePath, isCardSeenId, isCardSeenOccurrence, isCardSeenSessionId, mergeCardSeenComponent, mergeCardSeenSession, parseCardSeenComponent, parseCardSeenSession, sumCardSeen } from './cardSeenCounts';

const INDEX = 'pending.json';
const MAX_SESSION_CACHE = 8;
const MAX_UPLOADS_PER_FLUSH = 8;
const componentPath = (deckId: string, deviceId: string) => `${deckId}/${deviceId}.json`;
const sessionPath = (deckId: string, sessionId: string) => `${deckId}/sessions/${sessionId}.json`;
const emptyComponent = (deckId: string, deviceId: string): CardSeenComponent => ({ v:1, kind:'total', deckId, deviceId, counts:{} });
const same = (first: unknown, second: unknown) => JSON.stringify(first) === JSON.stringify(second);

function localOwner(path: string): CardSeenRemotePath {
  const owner = cardSeenRemotePath(cardSeenCloudPath(path));
  if (!owner) throw new Error('Invalid viewing-count file.');
  return owner;
}

function validateOccurrence(input: CardSeenRecordInput): void {
  if (!isCardSeenId(input.deckId) || !isCardSeenId(input.cardId) || !isCardSeenSessionId(input.sessionId)
    || !isCardSeenOccurrence(input.occurrenceId)) {
    throw new Error('Could not identify this viewing occurrence.');
  }
}

class SeenStore implements CardSeenStore {
  readonly deviceId: string;
  readonly ready: Promise<void>;
  private readonly config: CardSeenConfig;
  private readonly journalPath: string;
  private serial: Promise<unknown> = Promise.resolve();
  private readonly components = new Map<string, Map<string, CardSeenComponent>>();
  private readonly loaded = new Set<string>();
  private readonly sessions = new Map<string, CardSeenSession>();
  private readonly pending = new Set<string>();
  private readonly removed = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private readonly refreshes = new Map<string, Promise<void>>();
  private journal: CardSeenJournal | null = null;
  private flushTask: Promise<void> | null = null;
  private debounce: ReturnType<typeof setTimeout> | undefined;
  private deadline: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  private restored = false;

  constructor(config: CardSeenConfig) {
    if (!isCardSeenId(config.deviceId)) throw new Error('Viewing-count device is unavailable.');
    this.config = config;
    this.deviceId = config.deviceId;
    this.journalPath = `_journal-${config.deviceId}.json`;
    this.ready = this.restore();
    this.serial = this.ready.catch(() => {});
  }

  private async restore(): Promise<void> {
    const rawIndex = await this.config.local.readFile(INDEX);
    if (rawIndex !== null) {
      const index: unknown = JSON.parse(rawIndex);
      if (typeof index !== 'object' || index === null || !('v' in index) || index.v !== 1 || !('paths' in index) || !Array.isArray(index.paths)) throw new Error('Pending viewing-count index could not be read.');
      const recovered = new Set<string>();
      for (const path of index.paths) {
        if (typeof path !== 'string') throw new Error('Pending viewing-count index contains an invalid file.');
        const owner = localOwner(path);
        if (owner.kind === 'total' && owner.id !== this.deviceId) throw new Error('Pending viewing counts have another writer.');
        recovered.add(path);
      }
      this.pending.clear();
      for (const path of recovered) this.pending.add(path);
    }
    const rawJournal = await this.config.local.readFile(this.journalPath);
    if (rawJournal !== null) {
      const value: unknown = JSON.parse(rawJournal);
      if (typeof value !== 'object' || value === null || !('v' in value) || value.v !== 1 || !('component' in value) || !('session' in value) || !('pending' in value) || !Array.isArray(value.pending)) throw new Error('Viewing-count recovery could not be read.');
      const candidate = value.component as Partial<CardSeenComponent>;
      if (!isCardSeenId(candidate.deckId)) throw new Error('Viewing-count recovery has no deck.');
      const component = parseCardSeenComponent(JSON.stringify(value.component), candidate.deckId, this.deviceId);
      let session: CardSeenSession | null = null;
      if (value.session !== null) {
        if (typeof value.session !== 'object' || value.session === null) throw new Error('Viewing-count recovery has no session.');
        const sessionCandidate = value.session as Partial<CardSeenSession>;
        if (!isCardSeenSessionId(sessionCandidate.sessionId)) throw new Error('Viewing-count recovery has no session.');
        session = parseCardSeenSession(JSON.stringify(value.session), component.deckId, sessionCandidate.sessionId);
        if (session.deviceId !== this.deviceId) throw new Error('Viewing-count recovery has another writer.');
      }
      if (value.pending.some(path => typeof path !== 'string')) throw new Error('Viewing-count recovery contains an invalid file.');
      const pending = value.pending as string[];
      for (const path of pending) {
        const owner = localOwner(path);
        if (owner.kind === 'total' && owner.id !== this.deviceId) throw new Error('Viewing-count recovery has another component writer.');
      }
      this.journal = { v:1, component, session, pending };
      await this.finishJournal();
    }
    this.restored = true;
    if (this.pending.size) this.scheduleFlush();
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const task = this.serial.then(async () => {
      // Protected storage and other transient startup failures can recover on
      // the next user action. Never replace an unreadable journal with zeroes.
      if (!this.restored) await this.restore();
      if (this.journal) await this.finishJournal();
      return work();
    });
    this.serial = task.catch(() => {});
    return task;
  }

  private notify(): void { for (const listener of this.listeners) listener(); }
  private componentMap(deckId: string): Map<string, CardSeenComponent> {
    let map = this.components.get(deckId);
    if (!map) { map = new Map(); this.components.set(deckId, map); }
    return map;
  }
  private cacheSession(session: CardSeenSession): void {
    this.sessions.delete(session.sessionId);
    this.sessions.set(session.sessionId, session);
    while (this.sessions.size > MAX_SESSION_CACHE) this.sessions.delete(this.sessions.keys().next().value!);
  }
  private async persistIndex(paths = this.pending): Promise<void> {
    await this.config.local.writeFile(INDEX, JSON.stringify({ v:1, paths:[...paths] }));
  }

  private async finishJournal(): Promise<void> {
    const journal = this.journal;
    if (!journal) return;
    const totalPath = componentPath(journal.component.deckId, this.deviceId);
    const currentTotal = await this.config.local.readFile(totalPath);
    const component = currentTotal === null ? journal.component : mergeCardSeenComponent(parseCardSeenComponent(currentTotal, journal.component.deckId, this.deviceId), journal.component);
    const pending = new Set([...this.pending, ...journal.pending, totalPath]);
    let session: CardSeenSession | null = null;
    if (journal.session) {
      const viewPath = sessionPath(journal.session.deckId, journal.session.sessionId);
      const currentSession = await this.config.local.readFile(viewPath);
      session = currentSession === null ? journal.session : mergeCardSeenSession(parseCardSeenSession(currentSession, journal.session.deckId, journal.session.sessionId), journal.session);
      pending.add(viewPath);
      await this.config.local.writeFile(viewPath, JSON.stringify(session));
    }
    await this.config.local.writeFile(totalPath, JSON.stringify(component));
    await this.persistIndex(pending);
    await this.config.local.deleteFile(this.journalPath);
    this.pending.clear();
    for (const path of pending) this.pending.add(path);
    this.componentMap(component.deckId).set(component.deviceId, component);
    if (session) this.cacheSession(session);
    this.journal = null;
    this.notify();
  }

  private async loadLocal(deckId: string): Promise<void> {
    if (!isCardSeenId(deckId) || this.removed.has(deckId)) throw new Error('Viewing-count deck is unavailable.');
    if (this.loaded.has(deckId)) return;
    const files = await this.config.local.listDirectory(deckId);
    const map = new Map<string, CardSeenComponent>();
    for (const filename of files) {
      const match = filename.match(/^([A-Za-z0-9_-]{1,160})\.json$/);
      if (!match?.[1]) continue;
      const raw = await this.config.local.readFile(`${deckId}/${filename}`);
      if (raw !== null) map.set(match[1], parseCardSeenComponent(raw, deckId, match[1]));
    }
    for (const [device, component] of this.components.get(deckId) ?? []) map.set(device, map.has(device) ? mergeCardSeenComponent(map.get(device)!, component) : component);
    if (!map.has(this.deviceId)) map.set(this.deviceId, emptyComponent(deckId, this.deviceId));
    this.components.set(deckId, map);
    this.loaded.add(deckId);
    this.notify();
  }

  async load(deckId: string): Promise<void> { await this.enqueue(() => this.loadLocal(deckId)); }

  async recover(): Promise<void> { await this.enqueue(async () => {}); }

  async startSession(input: CardSeenSessionInput): Promise<string> {
    return this.enqueue(async () => {
      await this.loadLocal(input.deckId);
      if (input.mode !== 'study' && input.mode !== 'practice') throw new Error('Viewing session mode is unavailable.');
      const sessionId = (this.config.makeSessionId ?? uuidv4)();
      if (!isCardSeenSessionId(sessionId)) throw new Error('Viewing session could not be identified.');
      const path = sessionPath(input.deckId, sessionId);
      if (await this.config.local.readFile(path) !== null) throw new Error('This viewing session already exists.');
      const session: CardSeenSession = { v:1, kind:'session', deckId:input.deckId, deviceId:this.deviceId, sessionId, mode:input.mode, counts:{}, occurrences:{} };
      await this.config.local.writeFile(path, JSON.stringify(session));
      this.cacheSession(session);
      return sessionId;
    });
  }

  async record(input: CardSeenRecordInput): Promise<CardSeenStats> {
    validateOccurrence(input);
    return this.enqueue(async () => {
      await this.loadLocal(input.deckId);
      let session = this.sessions.get(input.sessionId);
      if (!session) {
        const raw = await this.config.local.readFile(sessionPath(input.deckId, input.sessionId));
        if (raw === null) throw new Error('This viewing session could not be found.');
        session = parseCardSeenSession(raw, input.deckId, input.sessionId);
      }
      if (session.deckId !== input.deckId || session.deviceId !== this.deviceId) throw new Error('This viewing session belongs to another owner.');
      const existing = session.occurrences[input.occurrenceId];
      if (existing !== undefined) {
        if (existing !== input.cardId) throw new Error('This viewing occurrence belongs to another card.');
        this.cacheSession(session);
        return this.getStats(input);
      }
      const own = this.componentMap(input.deckId).get(this.deviceId)!;
      const count = (own.counts[input.cardId] ?? 0) + 1;
      if (!Number.isSafeInteger(count)) throw new Error('Viewing count reached its supported limit.');
      const component: CardSeenComponent = { ...own, counts:{ ...own.counts, [input.cardId]:count } };
      const updated: CardSeenSession = { ...session, counts:{ ...session.counts, [input.cardId]:(session.counts[input.cardId] ?? 0) + 1 }, occurrences:{ ...session.occurrences, [input.occurrenceId]:input.cardId } };
      const pending = [...new Set([...this.pending, componentPath(input.deckId, this.deviceId), sessionPath(input.deckId, input.sessionId)])];
      const journal: CardSeenJournal = { v:1, component, session:updated, pending };
      await this.config.local.writeFile(this.journalPath, JSON.stringify(journal));
      this.journal = journal;
      await this.finishJournal();
      this.scheduleFlush();
      return this.getStats(input);
    });
  }

  async reset(input: CardSeenResetInput): Promise<CardSeenStats> {
    if (!isCardSeenId(input.deckId) || !isCardSeenId(input.cardId)) throw new Error('Could not identify this viewing count.');
    return this.enqueue(async () => {
      // A reset observes known local components only. It works offline and never
      // waits on iCloud; reveals not yet received from another device remain new.
      await this.loadLocal(input.deckId);
      const components = this.componentMap(input.deckId);
      const own = components.get(this.deviceId)!;
      const baselines = { ...own.resets?.[input.cardId] };
      for (const component of components.values()) {
        baselines[component.deviceId] = Math.max(baselines[component.deviceId] ?? 0, component.counts[input.cardId] ?? 0);
        for (const [writer, baseline] of Object.entries(component.resets?.[input.cardId] ?? {})) {
          baselines[writer] = Math.max(baselines[writer] ?? 0, baseline);
        }
      }
      const component: CardSeenComponent = { ...own, resets:{ ...own.resets, [input.cardId]:baselines } };
      const pending = [...new Set([...this.pending, componentPath(input.deckId, this.deviceId)])];
      const journal: CardSeenJournal = { v:1, component, session:null, pending };
      await this.config.local.writeFile(this.journalPath, JSON.stringify(journal));
      this.journal = journal;
      await this.finishJournal();
      this.scheduleFlush();
      return this.getStats({ deckId:input.deckId, cardId:input.cardId });
    });
  }

  getStats(input: CardSeenStatsInput): CardSeenStats {
    const session = input.sessionId ? this.sessions.get(input.sessionId) : undefined;
    return { lifetime:sumCardSeen(this.components.get(input.deckId)?.values() ?? [], input.cardId), session:session?.deckId === input.deckId ? session.counts[input.cardId] ?? 0 : 0 };
  }

  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }

  private canSync(): boolean { return !this.disposed && !!this.config.remote && (this.config.canSync?.() ?? (typeof navigator === 'undefined' || navigator.onLine !== false)); }
  private scheduleFlush(): void {
    if (!this.canSync() || !this.pending.size) return;
    if (this.debounce) clearTimeout(this.debounce);
    const trigger = () => { void this.flush().catch(error => this.config.onBackgroundError?.(error)); };
    this.debounce = setTimeout(trigger, this.config.debounceMs ?? 2000);
    this.deadline ??= setTimeout(trigger, this.config.maxWaitMs ?? 10000);
  }
  private clearTimers(): void {
    if (this.debounce) clearTimeout(this.debounce);
    if (this.deadline) clearTimeout(this.deadline);
    this.debounce = undefined;
    this.deadline = undefined;
  }

  async flush(): Promise<void> {
    if (this.flushTask) return this.flushTask;
    this.clearTimers();
    if (!this.canSync()) return;
    const task = (async () => {
      const paths = await this.enqueue(async () => [...this.pending].slice(0, MAX_UPLOADS_PER_FLUSH));
      for (const path of paths) {
        if (!this.canSync()) return;
        // A restored or stale local mirror must never replace a larger cloud
        // component/session. Read only this dirty file, outside the local queue.
        await this.mergeRemote(localOwner(path));
        const data = await this.enqueue(async () => {
          const owner = localOwner(path);
          if (this.removed.has(owner.deckId) || !this.pending.has(path)) return null;
          const raw = await this.config.local.readFile(path);
          if (raw === null) throw new Error('A pending viewing-count file is missing.');
          if (owner.kind === 'total') parseCardSeenComponent(raw, owner.deckId, this.deviceId);
          else if (parseCardSeenSession(raw, owner.deckId, owner.id).deviceId !== this.deviceId) throw new Error('A pending viewing session has another writer.');
          return raw;
        });
        if (data === null) continue;
        // Cloud work never occupies the local-record queue or gates a card flip.
        await this.config.remote!.writeFile(cardSeenCloudPath(path), data);
        await this.enqueue(async () => {
          if (await this.config.local.readFile(path) !== data) return;
          const pending = new Set(this.pending);
          pending.delete(path);
          await this.persistIndex(pending);
          this.pending.delete(path);
        });
      }
    })();
    this.flushTask = task;
    try { await task; }
    finally { this.flushTask = null; }
    if (this.pending.size) this.scheduleFlush();
  }

  private async mergeRemote(owner: CardSeenRemotePath): Promise<void> {
    if (!this.canSync() || this.removed.has(owner.deckId)) return;
    const raw = await this.config.remote!.readFile(cardSeenCloudPath(owner.localPath));
    if (raw === null) return;
    const incoming = owner.kind === 'total' ? parseCardSeenComponent(raw, owner.deckId, owner.id) : parseCardSeenSession(raw, owner.deckId, owner.id);
    await this.enqueue(async () => {
      if (this.removed.has(owner.deckId)) return;
      await this.loadLocal(owner.deckId);
      if (incoming.kind === 'total') {
        const map = this.componentMap(owner.deckId);
        const previous = map.get(owner.id) ?? emptyComponent(owner.deckId, owner.id);
        const merged = mergeCardSeenComponent(previous, incoming);
        if (same(previous, merged)) return;
        await this.config.local.writeFile(owner.localPath, JSON.stringify(merged));
        map.set(owner.id, merged);
      } else {
        const existing = await this.config.local.readFile(owner.localPath);
        const merged = existing === null ? incoming : mergeCardSeenSession(parseCardSeenSession(existing, owner.deckId, owner.id), incoming);
        if (existing !== null && same(JSON.parse(existing), merged)) return;
        await this.config.local.writeFile(owner.localPath, JSON.stringify(merged));
        if (this.sessions.has(owner.id)) this.cacheSession(merged);
      }
      this.notify();
    });
  }

  async refresh(deckId: string): Promise<void> {
    const existing = this.refreshes.get(deckId);
    if (existing) return existing;
    const task = (async () => {
      await this.load(deckId);
      if (!this.canSync()) return;
      const filenames = await this.config.remote!.listDirectory(`${deckId}/seen-v1`);
      for (const name of filenames) {
        const owner = cardSeenRemotePath(`${deckId}/seen-v1/${name}`);
        // Historical session documents remain separate; never scan/decode them here.
        if (owner?.kind === 'total') await this.mergeRemote(owner);
      }
    })();
    this.refreshes.set(deckId, task);
    try { await task; } finally { this.refreshes.delete(deckId); }
  }

  async handleChanges(changes: readonly CardSeenFileChange[], activeDeckId?: string): Promise<void> {
    const paths = new Map<string, CardSeenRemotePath>();
    for (const change of changes) {
      if (change.event !== 'added' && change.event !== 'changed') continue;
      const owner = cardSeenRemotePath(change.path);
      if (!owner || owner.deckId !== activeDeckId || this.removed.has(owner.deckId)) continue;
      // Own writes are echoes; current sessions are read only if already in use.
      if (owner.kind === 'total' && owner.id === this.deviceId) continue;
      if (owner.kind === 'session' && !this.sessions.has(owner.id)) continue;
      paths.set(owner.localPath, owner);
    }
    for (const owner of paths.values()) await this.mergeRemote(owner);
  }

  async removeDeck(deckId: string): Promise<void> {
    if (!isCardSeenId(deckId)) throw new Error('Invalid viewing-count deck.');
    await this.enqueue(async () => {
      this.removed.add(deckId);
      const pending = new Set([...this.pending].filter(path => !path.startsWith(`${deckId}/`)));
      await this.persistIndex(pending);
      this.pending.clear(); for (const path of pending) this.pending.add(path);
      this.components.delete(deckId); this.loaded.delete(deckId);
      for (const [id, session] of this.sessions) if (session.deckId === deckId) this.sessions.delete(id);
      this.notify();
    });
    await this.flushTask?.catch(() => {});
    for (const [storage, base] of [[this.config.local, deckId], [this.config.remote, `${deckId}/seen-v1`]] as const) {
      if (!storage) continue;
      for (const directory of [base, `${base}/sessions`]) {
        const files = await storage.listDirectory(directory);
        for (const name of files) {
          if (/^[A-Za-z0-9_-]+\.json$/.test(name)) await storage.deleteFile(`${directory}/${name}`);
        }
      }
    }
  }

  dispose(): void { this.disposed = true; this.clearTimers(); this.listeners.clear(); }
}

/** Create an isolated count store with injected local/cloud files.
 * @param config - Stable device identity and file ports.
 * @returns A store whose ready promise restores any interrupted local count transaction.
 */
export function createCardSeenStore(config: CardSeenConfig): CardSeenStore { return new SeenStore(config); }

let singleton: CardSeenStore | null = null;
let resolveStore: ((store: CardSeenStore) => void) | undefined;
const waitingStore = new Promise<CardSeenStore>(resolve => { resolveStore = resolve; });
const globalListeners = new Set<() => void>();
const notifyGlobal = () => { for (const listener of globalListeners) listener(); };
const storeReady = async () => { const store = await waitingStore; await store.ready.catch(() => {}); return store; };

/** Initialize count storage independently of card/scheduling startup.
 * @param config - Stable local writer and local/cloud adapters.
 * @returns Local journal recovery completion; callers may report failure without blocking decks.
 */
export async function initializeCardSeen(config: CardSeenConfig): Promise<void> {
  if (singleton) { if (singleton.deviceId !== config.deviceId) throw new Error('Viewing-count writer changed unexpectedly.'); await singleton.recover(); return; }
  singleton = createCardSeenStore(config);
  singleton.subscribe(notifyGlobal);
  resolveStore?.(singleton);
  await singleton.ready;
  notifyGlobal();
}

/** Load only local lifetime components; cloud refresh never gates a reveal.
 * @param deckId - Deck whose cached counts are needed.
 * @returns Completion of local count loading.
 */
export async function loadCardSeen(deckId: string): Promise<void> { await (await storeReady()).load(deckId); }
/** Create an independent local session without changing scheduling.
 * @param input - Deck and study/practice mode.
 * @returns Its UUID after the empty session document is durable.
 */
export async function startCardSeenSession(input: CardSeenSessionInput): Promise<string> { return (await storeReady()).startSession(input); }
/** Durably record the first answer exposure for one queue occurrence.
 * @param input - Captured deck/card/session and idempotent occurrence identity.
 * @returns Local resettable reveal total and unchanged historical session count; cloud upload errors never reject this operation.
 */
export async function recordCardSeen(input: CardSeenRecordInput): Promise<CardSeenStats> { return (await storeReady()).record(input); }
/** Reset one card's displayed reveal total without changing sessions, ratings or scheduling.
 * @param input - Deck/card whose currently known reveals should be cleared from the display.
 * @returns Durable local totals; unseen offline reveals may arrive on a later cloud merge.
 */
export async function resetCardSeen(input: CardSeenResetInput): Promise<CardSeenStats> { return (await storeReady()).reset(input); }
/** Read the latest loaded totals without IO or optimistic increments.
 * @param input - Deck/card and optional current session.
 * @returns Last durable total above reset baselines and the historical session count.
 */
export function getCardSeenStats(input: CardSeenStatsInput): CardSeenStats { return singleton?.getStats(input) ?? { lifetime:0, session:0 }; }
/** Observe durable local count changes, including late initialization.
 * @param listener - Re-read totals when this fires.
 * @returns Unsubscribe callback.
 */
export function subscribeCardSeen(listener: () => void): () => void { globalListeners.add(listener); return () => { globalListeners.delete(listener); }; }
/** Retry only dirty count files; no history scan or scheduling edits.
 * @returns Current bounded upload pass completion.
 */
export async function flushCardSeen(): Promise<void> { await (await storeReady()).flush(); }
/** Refresh lifetime components for the active deck only.
 * @param deckId - Active deck owner.
 * @returns Remote merge completion, with existing local data retained on failure.
 */
export async function refreshCardSeen(deckId: string): Promise<void> { await (await storeReady()).refresh(deckId); }
/** Reuse the existing iCloud watcher without replaying scheduler edits for count files.
 * @param changes - Existing metadata notifications.
 * @param activeDeckId - Deck currently displaying counts.
 * @returns Targeted merges for active count components/current sessions only.
 */
export async function handleCardSeenFileChanges(changes: readonly CardSeenFileChange[], activeDeckId?: string): Promise<void> { await (await storeReady()).handleChanges(changes, activeDeckId); }
/** Delete count-owned files only after an explicit deck deletion.
 * @param deckId - Confirmed deleted deck.
 * @returns Count cleanup completion; cards/media/scheduling files are never touched.
 */
export async function removeCardSeenDeck(deckId: string): Promise<void> { await (await storeReady()).removeDeck(deckId); }
