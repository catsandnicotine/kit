import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCardSeenReset } from './cardSeenReset';
import type { CardSeenStats } from '../types/cardSeen';
import type { CardSeenResetIdentity } from '../types/cardSeenReset';

const cardA = { deckId:'deck-a', cardId:'card-a' };
const cardB = { deckId:'deck-b', cardId:'card-b' };
const controllers: ReturnType<typeof createCardSeenReset>[] = [];

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

async function settled() {
  await Promise.resolve();
  await Promise.resolve();
}

function setup() {
  const counts = new Map([['card-a', 3], ['card-b', 7]]);
  const listeners = new Set<() => void>();
  const emit = () => { for (const listener of listeners) listener(); };
  const read = vi.fn((identity: CardSeenResetIdentity): CardSeenStats => ({ lifetime:counts.get(identity.cardId) ?? 0, session:0 }));
  const load = vi.fn<(deckId: string) => Promise<void>>().mockResolvedValue(undefined);
  const reset = vi.fn(async (identity: CardSeenResetIdentity): Promise<CardSeenStats> => {
    counts.set(identity.cardId, 0);
    emit();
    return { lifetime:0, session:0 };
  });
  const onReset = vi.fn();
  const controller = createCardSeenReset({ load, read, reset, subscribe:listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, onReset });
  controllers.push(controller);
  controller.subscribe(() => {});
  return { controller, counts, emit, load, read, reset, onReset, listeners };
}

afterEach(() => {
  for (const controller of controllers.splice(0)) controller.dispose();
  vi.useRealTimers();
});

describe('card seen reset editor controller', () => {
  it('keeps unknown counts unknown and ignores a different card’s late load', async () => {
    const { controller, load } = setup();
    const firstLoad = deferred<void>();
    load.mockImplementationOnce(() => firstLoad.promise);
    controller.select(cardA);
    expect(controller.getSnapshot()).toMatchObject({ lifetime:null, phase:'loading' });
    controller.request();
    expect(controller.getSnapshot().phase).toBe('loading');
    controller.select(cardB);
    await settled();
    expect(controller.getSnapshot()).toMatchObject({ cardKey:JSON.stringify(['deck-b', 'card-b']), lifetime:7, phase:'ready' });
    firstLoad.resolve();
    await settled();
    expect(controller.getSnapshot().lifetime).toBe(7);
  });

  it('uses authoritative subscription totals, including decreases and zero', async () => {
    const { controller, counts, emit, reset } = setup();
    controller.select(cardA);
    await settled();
    counts.set('card-a', 1); emit();
    expect(controller.getSnapshot().lifetime).toBe(1);
    counts.set('card-a', 0); emit();
    controller.request();
    await controller.confirm();
    expect(controller.getSnapshot()).toMatchObject({ lifetime:0, phase:'ready' });
    expect(reset).not.toHaveBeenCalled();
  });

  it('requires explicit confirmation and cancels without saving or feedback', async () => {
    const { controller, reset, onReset } = setup();
    controller.select(cardA);
    await settled();
    await controller.confirm();
    controller.request();
    expect(controller.getSnapshot().phase).toBe('confirming');
    expect(reset).not.toHaveBeenCalled();
    controller.cancel();
    await controller.confirm();
    expect(controller.getSnapshot()).toMatchObject({ lifetime:3, phase:'ready' });
    expect(reset).not.toHaveBeenCalled();
    expect(onReset).not.toHaveBeenCalled();
  });

  it('closes a redundant confirmation when an authoritative update already clears the count', async () => {
    const { controller, counts, emit, reset } = setup();
    controller.select(cardA);
    await settled();
    controller.request();
    expect(controller.getSnapshot().phase).toBe('confirming');
    counts.set('card-a', 0); emit();
    expect(controller.getSnapshot()).toMatchObject({ lifetime:0, phase:'ready' });
    await controller.confirm();
    expect(reset).not.toHaveBeenCalled();
  });

  it('saves only once while busy and reports success only after durable completion', async () => {
    vi.useFakeTimers();
    const { controller, counts, reset, onReset } = setup();
    const write = deferred<CardSeenStats>();
    reset.mockImplementationOnce(() => write.promise);
    controller.select(cardA);
    await settled();
    controller.request();
    const save = controller.confirm();
    await controller.confirm();
    controller.cancel();
    controller.request();
    expect(reset).toHaveBeenCalledExactlyOnceWith(cardA);
    expect(controller.isBusy()).toBe(true);
    expect(controller.getSnapshot()).toMatchObject({ phase:'resetting', lifetime:3, status:null });
    expect(onReset).not.toHaveBeenCalled();
    counts.set('card-a', 0);
    write.resolve({ lifetime:0, session:0 });
    await save;
    expect(controller.isBusy()).toBe(false);
    expect(controller.getSnapshot()).toMatchObject({ phase:'ready', lifetime:0, status:'Seen count reset.', error:null });
    expect(onReset).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2600);
    expect(controller.getSnapshot().status).toBeNull();
  });

  it('keeps a later authoritative update instead of an earlier reset result', async () => {
    const { controller, counts, emit, reset } = setup();
    const write = deferred<CardSeenStats>();
    reset.mockImplementationOnce(() => write.promise);
    controller.select(cardA);
    await settled();
    controller.request();
    const save = controller.confirm();
    counts.set('card-a', 1); emit();
    write.resolve({ lifetime:0, session:0 });
    await save;
    expect(controller.getSnapshot().lifetime).toBe(1);
  });

  it('shows a failed save without clearing the known count and allows an explicit retry', async () => {
    const { controller, reset, onReset } = setup();
    reset.mockRejectedValueOnce(new Error('storage unavailable'));
    controller.select(cardA);
    await settled();
    controller.request();
    await controller.confirm();
    expect(controller.getSnapshot()).toMatchObject({ phase:'ready', lifetime:3, error:'Couldn’t reset the seen count. Try again.', status:null });
    expect(onReset).not.toHaveBeenCalled();
    controller.request();
    await controller.confirm();
    expect(reset).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot()).toMatchObject({ lifetime:0, error:null });
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('does not show an old card’s reset result or feedback after its identity changes', async () => {
    const { controller, reset, onReset } = setup();
    const write = deferred<CardSeenStats>();
    reset.mockImplementationOnce(() => write.promise);
    controller.select(cardA);
    await settled();
    controller.request();
    const save = controller.confirm();
    controller.select(cardB);
    await settled();
    controller.request();
    expect(reset).toHaveBeenCalledTimes(1);
    expect(controller.isBusy()).toBe(true);
    write.resolve({ lifetime:0, session:0 });
    await save;
    expect(controller.getSnapshot()).toMatchObject({ cardKey:JSON.stringify(['deck-b', 'card-b']), lifetime:7, phase:'ready', error:null, status:null });
    expect(onReset).not.toHaveBeenCalled();
  });

  it('does not invent zero on load failure or write for a disabled/new card', async () => {
    const { controller, load, reset } = setup();
    controller.select(null);
    controller.request();
    await controller.confirm();
    expect(load).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
    load.mockRejectedValueOnce(new Error('unavailable'));
    controller.select(cardA);
    await settled();
    expect(controller.getSnapshot()).toMatchObject({ lifetime:null, phase:'ready', error:'Couldn’t load this card’s seen count.' });
    controller.request();
    await controller.confirm();
    expect(reset).not.toHaveBeenCalled();
  });

  it('removes its store subscription and ignores pending results after disposal', async () => {
    const { controller, reset, onReset, listeners } = setup();
    const write = deferred<CardSeenStats>();
    reset.mockImplementationOnce(() => write.promise);
    controller.select(cardA);
    await settled();
    controller.request();
    const save = controller.confirm();
    controller.dispose();
    expect(listeners.size).toBe(0);
    write.resolve({ lifetime:0, session:0 });
    await save;
    expect(onReset).not.toHaveBeenCalled();
    expect(controller.getSnapshot().status).toBeNull();
  });
});
