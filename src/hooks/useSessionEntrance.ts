import { useLayoutEffect, useRef, useState } from 'react';
import { prepareSessionEntrance, SESSION_ENTRANCE_IMAGE_BUDGET_MS } from '../lib/sessionEntrance';
import type { SessionEntranceBudget, SessionEntranceOptions, SessionEntranceState } from '../types/sessionEntrance';

/** Reveal a session once its first front is usable, without delaying later cards.
 * @param options - Entry identity, underlying readiness, inserted HTML key and actual session root.
 * @returns A readiness latch that remains true through flips and next-card loads.
 */
export function useSessionEntrance({ identity, ready, contentKey, rootRef }: SessionEntranceOptions): boolean {
  const [entry, setEntry] = useState<SessionEntranceState>(() => ({ identity, ready:false }));
  const budget = useRef<SessionEntranceBudget | null>(null);
  if (entry.identity !== identity) {
    budget.current = null;
    setEntry({ identity, ready:false });
  }
  const visible = entry.identity === identity && entry.ready;
  useLayoutEffect(() => {
    if (visible || !ready) return;
    const now = performance.now();
    if (budget.current?.identity !== identity) budget.current = { identity, deadline:now + SESSION_ENTRANCE_IMAGE_BUDGET_MS };
    return prepareSessionEntrance(rootRef.current, () => {
      setEntry(previous => previous.identity === identity && !previous.ready ? { identity, ready:true } : previous);
    }, Math.max(0, budget.current.deadline - now));
  }, [identity, ready, contentKey, rootRef, visible]);
  return visible;
}
