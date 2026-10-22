import { useCallback, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { createCardSeenPresentation } from '../lib/cardSeenPresentation';
import { getCardSeenStats, loadCardSeen, recordCardSeen, startCardSeenSession, subscribeCardSeen } from '../lib/cardSeen';
import type { UseCardSeenOptions } from '../types/cardSeenUi';

/** Record the first answer exposure of a queue occurrence without delaying its flip.
 * @param options - Current card, stable session/occurrence identity and existing flip action.
 * @returns A durable lifetime count, a wrapped flip and one dismissible storage notice.
 */
export function useCardSeen({ deckId, cardId, occurrenceId, sessionKey, mode, face, enabled, onFlip }: UseCardSeenOptions) {
  const [tracker] = useState(() => createCardSeenPresentation({
    startSession:startCardSeenSession, loadDeck:loadCardSeen, record:recordCardSeen, read:getCardSeenStats, subscribe:subscribeCardSeen,
  }));
  const snapshot = useSyncExternalStore(tracker.subscribe, tracker.getSnapshot, tracker.getSnapshot);
  useLayoutEffect(() => {
    tracker.select(enabled && deckId && cardId && occurrenceId ? { deckId, cardId, occurrenceId, sessionKey, mode } : null);
  }, [tracker, enabled, deckId, cardId, occurrenceId, sessionKey, mode]);
  const flip = useCallback(() => {
    if (enabled && face === 'front' && deckId && cardId && occurrenceId) {
      tracker.reveal({ deckId, cardId, occurrenceId, sessionKey, mode });
    }
    onFlip();
  }, [tracker, enabled, face, deckId, cardId, occurrenceId, sessionKey, mode, onFlip]);
  const visibleKey = enabled && deckId && cardId ? JSON.stringify([deckId, cardId]) : null;
  return { flip, count:snapshot.cardKey === visibleKey ? snapshot.lifetime : null, error:snapshot.error, dismissError:tracker.dismissError };
}
