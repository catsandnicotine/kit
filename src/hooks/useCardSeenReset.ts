import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { getCardSeenStats, loadCardSeen, resetCardSeen, subscribeCardSeen } from '../lib/cardSeen';
import { createCardSeenReset } from '../lib/cardSeenReset';
import { hapticTap } from '../lib/platform/haptics';
import type { CardSeenResetOptions } from '../types/cardSeenReset';

/** Offer a count-only reset while leaving card drafts and scheduling untouched.
 * @param options - Existing card identity; new cards leave the feature disabled.
 * @returns Authoritative count, inline confirmation state and guarded reset actions.
 */
export function useCardSeenReset({ deckId, cardId, enabled }: CardSeenResetOptions) {
  const [controller] = useState(() => createCardSeenReset({
    load:loadCardSeen, read:getCardSeenStats, reset:resetCardSeen, subscribe:subscribeCardSeen,
    onReset:() => { void hapticTap(); },
  }));
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useLayoutEffect(() => {
    controller.select(enabled ? { deckId, cardId } : null);
    return () => controller.select(null);
  }, [controller, enabled, deckId, cardId]);
  useEffect(() => () => controller.dispose(), [controller]);
  const key = enabled ? JSON.stringify([deckId, cardId]) : null;
  const selected = snapshot.cardKey === key;
  return {
    count:selected ? snapshot.lifetime : null,
    loading:!selected || snapshot.phase === 'loading',
    busy:snapshot.phase === 'resetting',
    confirming:selected && (snapshot.phase === 'confirming' || snapshot.phase === 'resetting'),
    error:selected ? snapshot.error : null,
    status:selected ? snapshot.status : null,
    isBusy:controller.isBusy,
    requestReset:controller.request,
    cancelReset:controller.cancel,
    confirmReset:controller.confirm,
  };
}
