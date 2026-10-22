import type { CardSeenGateway, CardSeenPresentation, CardSeenSnapshot } from '../types/cardSeenUi';

const cardKey = (deckId: string, cardId: string) => JSON.stringify([deckId, cardId]);
const sessionKey = (presentation: CardSeenPresentation) => JSON.stringify([presentation.deckId, presentation.mode, presentation.sessionKey]);

/** Coordinate asynchronous reveal storage without blocking a visual flip.
 * @param gateway - Durable count storage, injected so delayed and failed saves can be tested.
 * @returns A session-scoped occurrence latch and a stale-result-safe observable counter.
 */
export function createCardSeenPresentation(gateway: CardSeenGateway) {
  let current: CardSeenPresentation | null = null;
  let snapshot: CardSeenSnapshot = { cardKey:null, lifetime:null, error:null };
  let errorReported = false;
  let unsubscribe: (() => void) | null = null;
  const listeners = new Set<() => void>();
  const sessions = new Map<string, Promise<string>>();
  const loads = new Map<string, Promise<void>>();
  const loaded = new Set<string>();
  const claimed = new Set<string>();
  const knownTotals = new Map<string, number>();

  const publish = (next: CardSeenSnapshot) => {
    if (next.cardKey === snapshot.cardKey && next.lifetime === snapshot.lifetime && next.error === snapshot.error) return;
    snapshot = next;
    for (const listener of listeners) listener();
  };
  const reportError = () => {
    if (errorReported) return;
    errorReported = true;
    publish({ ...snapshot, error:'Reveal count unavailable' });
  };
  const remember = (deckId: string, cardId: string, lifetime: number) => {
    const key = cardKey(deckId, cardId);
    knownTotals.set(key, lifetime);
    if (current && key === cardKey(current.deckId, current.cardId)) publish({ ...snapshot, cardKey:key, lifetime });
  };
  const refresh = () => {
    if (!current || !loaded.has(current.deckId)) return;
    try {
      const stats = gateway.read({ deckId:current.deckId, cardId:current.cardId });
      remember(current.deckId, current.cardId, stats.lifetime);
    } catch { reportError(); }
  };
  const ensureSession = (presentation: CardSeenPresentation) => {
    const key = sessionKey(presentation);
    const existing = sessions.get(key);
    if (existing) return existing;
    const promise = Promise.resolve().then(() => gateway.startSession({ deckId:presentation.deckId, mode:presentation.mode }));
    sessions.set(key, promise);
    void promise.catch(() => {
      if (sessions.get(key) === promise) sessions.delete(key);
      reportError();
    });
    return promise;
  };
  const ensureLoad = (deckId: string) => {
    if (loads.has(deckId)) return;
    const promise = Promise.resolve().then(() => gateway.loadDeck(deckId)).then(() => {
      loaded.add(deckId);
      if (current?.deckId === deckId) refresh();
    }).catch(() => {
      if (loads.get(deckId) === promise) loads.delete(deckId);
      reportError();
    });
    loads.set(deckId, promise);
  };

  return {
    select(presentation: CardSeenPresentation | null) {
      current = presentation;
      const key = presentation ? cardKey(presentation.deckId, presentation.cardId) : null;
      publish({ ...snapshot, cardKey:key, lifetime:key ? knownTotals.get(key) ?? null : null });
      if (!presentation) return;
      ensureSession(presentation);
      ensureLoad(presentation.deckId);
      refresh();
    },
    reveal(presentation: CardSeenPresentation) {
      const key = JSON.stringify([sessionKey(presentation), presentation.occurrenceId]);
      if (claimed.has(key)) return;
      claimed.add(key);
      const captured = { ...presentation };
      ensureLoad(captured.deckId);
      void ensureSession(captured).then(sessionId => gateway.record({
        deckId:captured.deckId, sessionId, cardId:captured.cardId, occurrenceId:captured.occurrenceId,
      })).then(() => {
        // A reset can finish between the durable write and this continuation.
        // Always re-read current storage rather than revive a stale record result.
        const stats = gateway.read({ deckId:captured.deckId, cardId:captured.cardId });
        remember(captured.deckId, captured.cardId, stats.lifetime);
      }).catch(() => {
        // A failed save may be retried on a later explicit reveal of this occurrence.
        claimed.delete(key);
        reportError();
      });
    },
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (!unsubscribe) unsubscribe = gateway.subscribe(refresh);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) { unsubscribe?.(); unsubscribe = null; }
      };
    },
    dismissError() { publish({ ...snapshot, error:null }); },
  };
}
