/**
 * useDeckMedia — manages object URLs for a deck's media files.
 *
 * Lifecycle:
 *  1. When deckId changes, query all media **filenames** (no blobs).
 *  2. When rewriteHtml encounters a known filename, lazily fetch the blob
 *     from the database and create an object URL on demand.
 *  3. Cache created URLs so each blob is fetched at most once.
 *  4. When deckId changes or the component unmounts, revoke all URLs
 *     to free the underlying memory.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Database } from 'sql.js';
import { getMediaFilenames, getMediaBlobByFilename } from '../lib/db/queries';
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
  /** True while media filenames are being loaded from the database. */
  loading: boolean;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Load media filenames for a deck and provide a lazy HTML rewriter.
 *
 * Object URLs are created on demand (only for media actually referenced in
 * card HTML) and revoked when the deck changes or the component unmounts.
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
  /** Set of known media filenames (fetched without blob data). */
  const knownFilesRef = useRef<Set<string>>(new Set());
  /** Lazy cache: filename → blob: object URL (populated on demand). */
  const urlCacheRef = useRef<Map<string, string>>(new Map());
  /** Stable ref to the db for use in the rewrite callback. */
  const dbRef = useRef<Database | null>(null);

  // Revoke all current object URLs.
  const revokeAll = useCallback(() => {
    for (const url of urlCacheRef.current.values()) {
      URL.revokeObjectURL(url);
    }
    urlCacheRef.current = new Map();
    knownFilesRef.current = new Set();
  }, []);

  useEffect(() => {
    // Revoke previous deck's URLs before loading new ones.
    revokeAll();
    setLoading(true);
    dbRef.current = db;

    if (!db) {
      setLoading(false);
      return;
    }

    // Only fetch filenames — no blob data loaded here.
    const result = getMediaFilenames(db);
    if (result.success) {
      knownFilesRef.current = result.data;
    }
    setLoading(false);

    // Revoke on unmount or before next effect run.
    return revokeAll;
  }, [db, deckId, revokeAll]);

  /**
   * Lazily resolve a media filename to a blob: URL.
   * Fetches the blob from SQLite and creates an object URL on first access.
   */
  const resolveUrl = useCallback((filename: string): string | undefined => {
    // Already cached?
    const cached = urlCacheRef.current.get(filename);
    if (cached) return cached;

    // Not a known media file?
    if (!knownFilesRef.current.has(filename)) return undefined;

    // Fetch blob from DB on demand
    const db = dbRef.current;
    if (!db) return undefined;

    const result = getMediaBlobByFilename(db, filename);
    if (!result.success || !result.data) return undefined;

    const blob = result.data;
    const buffer = blob.data.buffer.slice(
      blob.data.byteOffset,
      blob.data.byteOffset + blob.data.byteLength,
    ) as ArrayBuffer;
    const objectUrl = URL.createObjectURL(
      new Blob([buffer], { type: blob.mimeType }),
    );
    urlCacheRef.current.set(filename, objectUrl);
    return objectUrl;
  }, []);

  const rewriteHtml = useCallback(
    (html: string): string => {
      // Build a lazy proxy map that resolves URLs on demand
      const proxyMap: ReadonlyMap<string, string> = {
        get size() { return knownFilesRef.current.size; },
        get(key: string) { return resolveUrl(key); },
        has(key: string) { return knownFilesRef.current.has(key); },
        forEach() { /* not used by rewriteMediaUrls */ },
        entries() { return (new Map<string, string>()).entries(); },
        keys() { return knownFilesRef.current.keys(); },
        values() { return (new Map<string, string>()).values(); },
        [Symbol.iterator]() { return (new Map<string, string>())[Symbol.iterator](); },
      };
      return rewriteMediaUrls(html, proxyMap);
    },
    [resolveUrl],
  );

  return { rewriteHtml, loading };
}
