import { describe, expect, it, vi } from 'vitest';
import { createCardSeenPresentation } from './cardSeenPresentation';
import type { CardSeenGateway, CardSeenPresentation } from '../types/cardSeenUi';
import type { CardSeenStats } from '../types/cardSeen';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const settle = () => new Promise<void>(resolve => setTimeout(resolve, 0));
const presentation: CardSeenPresentation = { deckId:'deck-a', cardId:'card-a', sessionKey:'visit-a', occurrenceId:'0', mode:'study' };

function gatewayFixture() {
  const totals = new Map<string, number>();
  const listeners = new Set<() => void>();
  let sessions = 0;
  const gateway: CardSeenGateway = {
    startSession:vi.fn(async () => `session-${++sessions}`),
    loadDeck:vi.fn(async () => undefined),
    record:vi.fn(async input => {
      const key = `${input.deckId}/${input.cardId}`;
      const lifetime = (totals.get(key) ?? 0) + 1;
      totals.set(key, lifetime);
      return { lifetime, session:1 };
    }),
    read:vi.fn(input => ({ lifetime:totals.get(`${input.deckId}/${input.cardId}`) ?? 0, session:0 })),
    subscribe:vi.fn(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }),
  };
  return { gateway, totals, emit:() => { for (const listener of listeners) listener(); } };
}

describe('answer-reveal presentation tracking', () => {
  it('queues the first reveal while initialization is pending without inventing a count', async () => {
    const fixture = gatewayFixture();
    const start = deferred<string>();
    const load = deferred<void>();
    fixture.gateway.startSession = vi.fn(() => start.promise);
    fixture.gateway.loadDeck = vi.fn(() => load.promise);
    const tracker = createCardSeenPresentation(fixture.gateway);
    tracker.select(presentation);
    tracker.reveal(presentation);
    tracker.reveal(presentation);
    expect(tracker.getSnapshot().lifetime).toBeNull();
    expect(fixture.gateway.record).not.toHaveBeenCalled();
    start.resolve('delayed-session');
    await settle();
    expect(fixture.gateway.record).toHaveBeenCalledExactlyOnceWith({ deckId:'deck-a', cardId:'card-a', occurrenceId:'0', sessionId:'delayed-session' });
    expect(tracker.getSnapshot().lifetime).toBe(1);
    load.resolve();
    await settle();
    expect(tracker.getSnapshot().lifetime).toBe(1);
  });

  it('deduplicates toggles, edits and Undo while counting a new repeat or session', async () => {
    const fixture = gatewayFixture();
    const tracker = createCardSeenPresentation(fixture.gateway);
    tracker.select(presentation);
    tracker.reveal(presentation);
    tracker.reveal({ ...presentation });
    await settle();
    tracker.select({ ...presentation });
    tracker.reveal(presentation);
    const repeated = { ...presentation, occurrenceId:'repeat-uuid' };
    tracker.select(repeated);
    tracker.reveal(repeated);
    await settle();
    tracker.select(presentation); // Undo returns to the original occurrence.
    tracker.reveal(presentation);
    const newSession = { ...presentation, sessionKey:'visit-b' };
    tracker.select(newSession);
    tracker.reveal(newSession);
    await settle();
    expect(fixture.gateway.record).toHaveBeenCalledTimes(3);
    expect(fixture.gateway.startSession).toHaveBeenCalledTimes(2);
    expect(tracker.getSnapshot().lifetime).toBe(3);
  });

  it('keeps late saves attached to their original card instead of replacing the current count', async () => {
    const fixture = gatewayFixture();
    fixture.totals.set('deck-a/card-a', 3);
    fixture.totals.set('deck-a/card-b', 6);
    const saved = deferred<CardSeenStats>();
    fixture.gateway.record = vi.fn(() => saved.promise);
    const tracker = createCardSeenPresentation(fixture.gateway);
    tracker.select(presentation);
    await settle();
    tracker.reveal(presentation);
    tracker.select({ ...presentation, cardId:'card-b', occurrenceId:'1' });
    expect(tracker.getSnapshot().lifetime).toBe(6);
    fixture.totals.set('deck-a/card-a', 4);
    saved.resolve({ lifetime:4, session:1 });
    await settle();
    expect(tracker.getSnapshot().lifetime).toBe(6);
    tracker.select(presentation);
    expect(tracker.getSnapshot().lifetime).toBe(4);
  });

  it('preserves durable totals on failure, shows one notice, and permits an explicit retry', async () => {
    const fixture = gatewayFixture();
    fixture.totals.set('deck-a/card-a', 5);
    const record = vi.fn<CardSeenGateway['record']>()
      .mockRejectedValueOnce(new Error('Disk full'))
      .mockImplementationOnce(async () => { fixture.totals.set('deck-a/card-a', 6); return { lifetime:6, session:1 }; })
      .mockRejectedValueOnce(new Error('Disk full again'));
    fixture.gateway.record = record;
    const tracker = createCardSeenPresentation(fixture.gateway);
    tracker.select(presentation);
    await settle();
    tracker.reveal(presentation);
    await settle();
    expect(tracker.getSnapshot()).toMatchObject({ lifetime:5, error:'Reveal count unavailable' });
    tracker.dismissError();
    tracker.reveal(presentation);
    await settle();
    expect(tracker.getSnapshot()).toMatchObject({ lifetime:6, error:null });
    tracker.reveal({ ...presentation, occurrenceId:'repeat-uuid' });
    await settle();
    expect(tracker.getSnapshot()).toMatchObject({ lifetime:6, error:null });
  });

  it('does not replace unknown data with a fabricated zero when loading fails', async () => {
    const fixture = gatewayFixture();
    fixture.gateway.loadDeck = vi.fn(async () => { throw new Error('Unreadable file'); });
    const tracker = createCardSeenPresentation(fixture.gateway);
    tracker.select(presentation);
    await settle();
    expect(tracker.getSnapshot().lifetime).toBeNull();
    expect(fixture.gateway.read).not.toHaveBeenCalled();
    expect(tracker.getSnapshot().error).toBe('Reveal count unavailable');
  });

  it('retries failed initialization only after another explicit reveal on the same page', async () => {
    const fixture = gatewayFixture();
    fixture.gateway.startSession = vi.fn<CardSeenGateway['startSession']>()
      .mockRejectedValueOnce(new Error('Temporary session failure'))
      .mockResolvedValueOnce('retry-session');
    fixture.gateway.loadDeck = vi.fn<CardSeenGateway['loadDeck']>()
      .mockRejectedValueOnce(new Error('Temporary read failure'))
      .mockResolvedValueOnce(undefined);
    const tracker = createCardSeenPresentation(fixture.gateway);
    tracker.select(presentation);
    await settle();
    await settle();
    expect(fixture.gateway.startSession).toHaveBeenCalledTimes(1);
    expect(fixture.gateway.loadDeck).toHaveBeenCalledTimes(1);
    expect(tracker.getSnapshot().lifetime).toBeNull();
    tracker.reveal(presentation);
    await settle();
    expect(fixture.gateway.startSession).toHaveBeenCalledTimes(2);
    expect(fixture.gateway.loadDeck).toHaveBeenCalledTimes(2);
    expect(fixture.gateway.record).toHaveBeenCalledExactlyOnceWith({ deckId:'deck-a', cardId:'card-a', occurrenceId:'0', sessionId:'retry-session' });
    expect(tracker.getSnapshot().lifetime).toBe(1);
    tracker.reveal(presentation);
    await settle();
    expect(fixture.gateway.record).toHaveBeenCalledTimes(1);
  });

  it('reuses the occurrence key after an uncertain write so durable retry cannot double count', async () => {
    const fixture = gatewayFixture();
    const storedOccurrences = new Set<string>();
    let first = true;
    fixture.gateway.record = vi.fn(async input => {
      storedOccurrences.add(input.occurrenceId);
      if (first) { first = false; throw new Error('Interrupted after journal persistence'); }
      fixture.totals.set(`${input.deckId}/${input.cardId}`, storedOccurrences.size);
      return { lifetime:storedOccurrences.size, session:storedOccurrences.size };
    });
    const tracker = createCardSeenPresentation(fixture.gateway);
    tracker.select(presentation);
    await settle();
    tracker.reveal(presentation);
    await settle();
    expect(tracker.getSnapshot().lifetime).toBe(0);
    tracker.reveal(presentation);
    await settle();
    expect(fixture.gateway.record).toHaveBeenCalledTimes(2);
    expect(tracker.getSnapshot().lifetime).toBe(1);
    expect(storedOccurrences.size).toBe(1);
  });

  it('captures deck and occurrence before async session creation and survives leaving the page', async () => {
    const fixture = gatewayFixture();
    const start = deferred<string>();
    fixture.gateway.startSession = vi.fn(() => start.promise);
    const tracker = createCardSeenPresentation(fixture.gateway);
    const listener = vi.fn();
    const disconnect = tracker.subscribe(listener);
    tracker.select(presentation);
    tracker.reveal(presentation);
    tracker.select(null);
    disconnect();
    start.resolve('captured-session');
    await settle();
    expect(fixture.gateway.record).toHaveBeenCalledExactlyOnceWith({ deckId:'deck-a', cardId:'card-a', occurrenceId:'0', sessionId:'captured-session' });
    expect(tracker.getSnapshot().lifetime).toBeNull();
  });

  it('accepts an authoritative reset decrease without clearing the occurrence latch', async () => {
    const fixture = gatewayFixture();
    fixture.totals.set('deck-a/card-a', 5);
    const tracker = createCardSeenPresentation(fixture.gateway);
    tracker.subscribe(() => {});
    tracker.select(presentation);
    await settle();
    tracker.reveal(presentation);
    await settle();
    expect(tracker.getSnapshot().lifetime).toBe(6);
    fixture.totals.set('deck-a/card-a', 0);
    fixture.emit();
    expect(tracker.getSnapshot().lifetime).toBe(0);
    tracker.reveal(presentation);
    expect(fixture.gateway.record).toHaveBeenCalledTimes(1);
    tracker.reveal({ ...presentation, occurrenceId:'repeat' });
    await settle();
    expect(tracker.getSnapshot().lifetime).toBe(1);
  });

  it('never resurrects a reset from a stale reveal result, even while unsubscribed', async () => {
    const fixture = gatewayFixture();
    fixture.totals.set('deck-a/card-a', 5);
    const saved = deferred<CardSeenStats>();
    fixture.gateway.record = vi.fn(() => saved.promise);
    const tracker = createCardSeenPresentation(fixture.gateway);
    tracker.select(presentation);
    await settle();
    tracker.reveal(presentation);
    await settle();
    fixture.totals.set('deck-a/card-a', 0);
    saved.resolve({ lifetime:6, session:1 });
    await settle();
    expect(tracker.getSnapshot().lifetime).toBe(0);
    tracker.select(null);
    tracker.select(presentation);
    expect(tracker.getSnapshot().lifetime).toBe(0);
  });
});
