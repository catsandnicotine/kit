/**
 * useDeckThumbnails — loads and manages deck thumbnail images.
 */

import { useCallback, useEffect, useState } from 'react';
import { loadAllThumbnails, saveThumbnail } from '../lib/platform/thumbnails';

export interface UseDeckThumbnailsReturn {
  /** Map from deckId to data: URL string. */
  thumbnails: Record<string, string>;
  /** Set a thumbnail for a deck (base64 JPEG, no prefix). */
  setThumbnail: (deckId: string, base64: string) => Promise<void>;
}

/**
 * Manages deck thumbnails. Loads all on mount.
 *
 * @param deckIds - Array of deck UUIDs to load thumbnails for.
 * @returns Thumbnail map and setter.
 */
export function useDeckThumbnails(deckIds: string[]): UseDeckThumbnailsReturn {
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});

  useEffect(() => {
    if (deckIds.length === 0) return;
    let cancelled = false;
    loadAllThumbnails(deckIds).then((loaded) => {
      if (!cancelled) setThumbnails(loaded);
    }).catch(() => { /* thumbnail load failed — degrade gracefully */ });
    return () => { cancelled = true; };
  }, [deckIds.join(',')]);

  const setThumbnail = useCallback(async (deckId: string, base64: string) => {
    await saveThumbnail(deckId, base64);
    setThumbnails(prev => ({
      ...prev,
      [deckId]: `data:image/jpeg;base64,${base64}`,
    }));
  }, []);

  return { thumbnails, setThumbnail };
}
