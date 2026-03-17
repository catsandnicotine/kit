/**
 * useDeckMedia — manages object URLs for a deck's media files.
 *
 * Lifecycle:
 *  1. When deckId changes, query all media blobs for the deck.
 *  2. Create a blob: object URL for each file via URL.createObjectURL.
 *  3. Build a filename → objectURL map for HTML rewriting.
 *  4. When deckId changes or the component unmounts, revoke all URLs
 *     to free the underlying memory.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Database } from 'sql.js';
import { getMediaByDeck } from '../lib/db/queries';
import { rewriteMediaUrls } from '../lib/media';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface UseDeckMediaReturn {
  /**
   * Rewrite media references in card HTML to use object URLs.
   * Call this on frontHtml/backHtml before rendering.
   *
   * @param html - Raw card HTML from the database.
   * @returns HTML with media filenames replaced by blob: URLs.
   */
  rewriteHtml: (html: string) => string;
  /** True while media is being loaded from the database. */
  loading: boolean;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Load all media for a deck, create object URLs, and provide an HTML rewriter.
 *
 * Object URLs are revoked when the deck changes or the component unmounts,
 * preventing memory leaks from accumulated blob references.
 *
 * @param db     - sql.js Database instance (null while loading).
 * @param deckId - UUID of the deck whose media to load.
 * @returns HTML rewriter function and loading state.
 */
export function useDeckMedia(
  db: Database | null,
  deckId: string,
): UseDeckMediaReturn {
  const [loading, setLoading] = useState(true);
  const urlMapRef = useRef<Map<string, string>>(new Map());

  // Revoke all current object URLs.
  const revokeAll = useCallback(() => {
    for (const url of urlMapRef.current.values()) {
      URL.revokeObjectURL(url);
    }
    urlMapRef.current = new Map();
  }, []);

  useEffect(() => {
    // Revoke previous deck's URLs before loading new ones.
    revokeAll();
    setLoading(true);

    if (!db) {
      setLoading(false);
      return;
    }

    const result = getMediaByDeck(db, deckId);
    if (!result.success) {
      setLoading(false);
      return;
    }

    const map = new Map<string, string>();
    for (const blob of result.data) {
      const objectUrl = URL.createObjectURL(
        new Blob([blob.data], { type: blob.mimeType }),
      );
      map.set(blob.filename, objectUrl);
    }
    urlMapRef.current = map;
    setLoading(false);

    // Revoke on unmount or before next effect run.
    return revokeAll;
  }, [db, deckId, revokeAll]);

  const rewriteHtml = useCallback(
    (html: string): string => rewriteMediaUrls(html, urlMapRef.current),
    [],
  );

  return { rewriteHtml, loading };
}
