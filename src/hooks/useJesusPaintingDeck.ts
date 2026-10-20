import { useCallback, useEffect, useRef, useState } from 'react';
import type { UseDeckManagerReturn } from './useDeckManager';
import { countEasterEggTap } from '../lib/easterEgg';
import { JESUS_PAINTING_DECK_ID } from '../lib/jesusPaintingAssets';
import { hapticSuccess, hapticTap } from '../lib/platform/haptics';

/** Discover the optional art deck through seven consecutive version taps.
 * @param manager - Active deck manager, or null while storage is initializing.
 * @param onOpen - Open the installed deck in the card browser.
 * @returns Version-tap action, installation state, and a recoverable error message.
 */
export function useJesusPaintingDeck(
  manager: UseDeckManagerReturn | null,
  onOpen: (deckId: string, deckName: string) => void,
) {
  const taps = useRef({ count: 0, lastTapAt: 0 });
  const working = useRef(false);
  const mounted = useRef(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const tapVersion = useCallback(async () => {
    if (!manager || working.current) return;
    const result = countEasterEggTap(taps.current, performance.now());
    taps.current = result.state;
    if (!result.unlocked) return;
    working.current = true;
    setBusy(true);
    setError('');
    hapticTap();
    try {
      const existing = manager.deckEntries.find(entry => entry.deckId === JESUS_PAINTING_DECK_ID);
      let name = existing?.name ?? 'Jesus in Paintings';
      if (existing) {
        const db = await manager.openDeckDb(JESUS_PAINTING_DECK_ID);
        if (!db) throw new Error('Could not open the paintings deck. Your cards have been kept.');
      } else {
        const [{ jesusPaintingCatalogue }, { createJesusPaintingDeckSnapshot }] = await Promise.all([
          import('../data/jesusPaintings'), import('../lib/db/jesusPaintingDeck'),
        ]);
        const snapshot = createJesusPaintingDeckSnapshot(jesusPaintingCatalogue);
        const db = await manager.createFromSnapshot(snapshot);
        if (!db) throw new Error('Could not save the paintings deck. Tap the version seven times to try again.');
        name = snapshot.deck.name;
        await manager.mergeImportedTags(snapshot.tags);
      }
      await manager.saveRegistry();
      manager.refreshDecks();
      if (mounted.current) {
        hapticSuccess();
        onOpen(JESUS_PAINTING_DECK_ID, name);
      }
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'Could not open the paintings deck. Try again.');
    } finally {
      working.current = false;
      if (mounted.current) setBusy(false);
    }
  }, [manager, onOpen]);

  return { tapVersion, busy, error };
}
