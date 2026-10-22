import type { CardSeenResetGateway, CardSeenResetIdentity, CardSeenResetSnapshot } from '../types/cardSeenReset';

const identityKey = (identity: CardSeenResetIdentity | null) => identity ? JSON.stringify([identity.deckId, identity.cardId]) : null;

/** Keep an explicit count reset independent of editor drafts and review scheduling.
 * @param gateway - The count store and one durable-success feedback callback.
 * @returns An observable confirmation/reset controller with stale-result guards.
 */
export function createCardSeenReset(gateway: CardSeenResetGateway) {
  let current: CardSeenResetIdentity | null = null;
  let revision = 0;
  let loaded = false;
  let pending = false;
  let snapshot: CardSeenResetSnapshot = { cardKey:null, lifetime:null, phase:'ready', error:null, status:null };
  let unsubscribe: (() => void) | null = null;
  let noticeTimer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<() => void>();
  const publish = (next: CardSeenResetSnapshot) => {
    snapshot = next;
    for (const listener of listeners) listener();
  };
  const clearNotice = () => {
    if (noticeTimer !== null) clearTimeout(noticeTimer);
    noticeTimer = null;
  };
  const refresh = () => {
    if (!current || !loaded) return;
    try {
      const stats = gateway.read(current);
      publish({ ...snapshot, lifetime:stats.lifetime, phase:snapshot.phase === 'confirming' && stats.lifetime <= 0 ? 'ready' : snapshot.phase });
    } catch {
      publish({ ...snapshot, error:'Couldn’t load this card’s seen count.' });
    }
  };
  const load = async (identity: CardSeenResetIdentity, selectedRevision: number) => {
    try {
      await gateway.load(identity.deckId);
      if (selectedRevision !== revision) return;
      const stats = gateway.read(identity);
      loaded = true;
      publish({ ...snapshot, lifetime:stats.lifetime, phase:pending ? 'resetting' : 'ready' });
    } catch {
      if (selectedRevision !== revision) return;
      publish({ ...snapshot, phase:pending ? 'resetting' : 'ready', error:'Couldn’t load this card’s seen count.' });
    }
  };
  return {
    select(identity: CardSeenResetIdentity | null) {
      clearNotice();
      current = identity;
      loaded = false;
      const selectedRevision = ++revision;
      publish({ cardKey:identityKey(identity), lifetime:null, phase:pending ? 'resetting' : identity ? 'loading' : 'ready', error:null, status:null });
      if (identity) void load({ ...identity }, selectedRevision);
    },
    request() {
      if (!current || pending || snapshot.phase !== 'ready' || snapshot.lifetime === null || snapshot.lifetime <= 0) return;
      clearNotice();
      publish({ ...snapshot, phase:'confirming', error:null, status:null });
    },
    cancel() {
      if (snapshot.phase !== 'confirming' || pending) return;
      publish({ ...snapshot, phase:'ready' });
    },
    async confirm() {
      if (!current || pending || snapshot.phase !== 'confirming' || snapshot.lifetime === null || snapshot.lifetime <= 0) return;
      const identity = { ...current };
      const selectedRevision = revision;
      pending = true;
      publish({ ...snapshot, phase:'resetting', error:null, status:null });
      try {
        const stats = await gateway.reset(identity);
        if (selectedRevision !== revision) return;
        // Read after the save so a newer subscription update cannot be replaced
        // by the reset promise's earlier result. The durable result is a fallback.
        let lifetime = stats.lifetime;
        try { lifetime = gateway.read(identity).lifetime; } catch { /* The reset itself is already durable. */ }
        publish({ ...snapshot, lifetime, phase:'ready', status:'Seen count reset.' });
        gateway.onReset();
        noticeTimer = setTimeout(() => {
          noticeTimer = null;
          if (selectedRevision === revision) publish({ ...snapshot, status:null });
        }, 2600);
      } catch {
        if (selectedRevision !== revision) return;
        publish({ ...snapshot, phase:'ready', error:'Couldn’t reset the seen count. Try again.' });
      } finally {
        pending = false;
        if (selectedRevision !== revision) {
          publish({ ...snapshot, phase:current && !loaded ? 'loading' : 'ready' });
        }
      }
    },
    isBusy: () => pending,
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (!unsubscribe) unsubscribe = gateway.subscribe(refresh);
      return () => {
        listeners.delete(listener);
        if (!listeners.size) { unsubscribe?.(); unsubscribe = null; }
      };
    },
    dispose() {
      clearNotice();
      current = null;
      loaded = false;
      revision++;
      unsubscribe?.();
      unsubscribe = null;
    },
  };
}
