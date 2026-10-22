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

import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { Database } from 'sql.js';
import { getMediaFilenames, getMediaBlobByFilename } from '../lib/db/queries';
import { rewriteMediaUrls } from '../lib/media';
import { listMediaFilenames, getMediaDirUri, mediaUriToWebUrl, getMediaFileWebUrl } from '../lib/platform/mediaFiles';
import { isNativePlatform } from '../lib/platform/platformDetect';
import { refreshBuiltInKitArtwork } from '../lib/kitCat';
import { WELCOME_DECK_ID } from '../lib/db/welcomeDeck';
import { getBundledPaintingFiles, getBundledPaintingUrl } from '../lib/jesusPaintingAssets';
import type { DeckMediaBootstrap, UseDeckMediaReturn } from '../types/deckMedia';

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
 * @param bootstrap - Optional native metadata prepared for this exact navigation/deck.
 * @returns HTML rewriter function and loading state.
 */
export function useDeckMedia(
  db: Database | null,
  deckId: string,
  bootstrap?: DeckMediaBootstrap | null,
): UseDeckMediaReturn {
  const [loading, setLoading] = useState(true);
  /** Set of known media filenames (fetched without blob data). */
  const knownFilesRef = useRef<Set<string>>(new Set());
  /** Lazy cache: filename → blob: object URL (populated on demand). */
  const urlCacheRef = useRef<Map<string, string>>(new Map());
  /** Stable ref to the db for use in the rewrite callback. */
  const dbRef = useRef<Database | null>(null);

  // Revoke all blob: URLs (capacitor:// URLs are not object URLs, skip them).
  const revokeAll = useCallback(() => {
    for (const url of urlCacheRef.current.values()) {
      if (url.startsWith('blob:')) URL.revokeObjectURL(url);
    }
    urlCacheRef.current = new Map();
    knownFilesRef.current = new Set();
  }, []);

  useLayoutEffect(() => {
    // Revoke previous deck's URLs before loading new ones.
    revokeAll();
    setLoading(true);
    dbRef.current = db;

    let cancelled = false;

    const addLegacyFilenames = () => {
      if (!db) return;
      const result = getMediaFilenames(db);
      if (!result.success) throw new Error(result.error);
      for (const filename of result.data) knownFilesRef.current.add(filename);
    };

    const applyNativeMetadata = (filenames: readonly string[], dirUri: string) => {
      knownFilesRef.current = new Set(filenames);
      if (dirUri) for (const filename of filenames) urlCacheRef.current.set(filename, mediaUriToWebUrl(dirUri, filename));
      addLegacyFilenames();
    };

    if (isNativePlatform()) {
      // On native: load filenames + directory URI from the filesystem, then
      // pre-populate the URL cache with capacitor:// URLs so resolveUrl is sync.
      if (bootstrap?.deckId === deckId) {
        try { applyNativeMetadata(bootstrap.filenames, bootstrap.dirUri); }
        catch (error) { console.warn('Could not load deck media metadata:', error); }
        finally { setLoading(false); }
      } else {
        void (async () => {
          try {
            const [filenames, dirUri] = await Promise.all([listMediaFilenames(deckId), getMediaDirUri(deckId)]);
            if (!cancelled) applyNativeMetadata(filenames, dirUri);
          } catch (error) { console.warn('Could not load deck media metadata:', error); }
          finally { if (!cancelled) setLoading(false); }
        })();
      }
    } else {
      void (async () => {
        try {
          const filenames = await listMediaFilenames(deckId);
          const entries = await Promise.all(filenames.map(async filename => [filename, await getMediaFileWebUrl(deckId, filename)] as const));
          if (cancelled) {
            for (const [, url] of entries) if (url.startsWith('blob:')) URL.revokeObjectURL(url);
            return;
          }
          knownFilesRef.current = new Set(filenames);
          for (const [filename, url] of entries) if (url) urlCacheRef.current.set(filename, url);
          // Retain legacy DB media as a fallback for decks imported before file storage.
          addLegacyFilenames();
        } catch (error) { console.warn('Could not load deck media metadata:', error); }
        finally { if (!cancelled) setLoading(false); }
      })();
    }

    // Revoke on unmount or before next effect run.
    return () => {
      cancelled = true;
      revokeAll();
    };
  }, [db, deckId, bootstrap, revokeAll]);

  /**
   * Lazily resolve a media filename to a blob: URL.
   * Fetches the blob from SQLite and creates an object URL on first access.
   */
  const resolveUrl = useCallback((filename: string): string | undefined => {
    // Already cached?
    const cached = urlCacheRef.current.get(filename);
    if (cached) return cached;

    // Not a known media file?
    if (!knownFilesRef.current.has(filename)) return getBundledPaintingUrl(deckId, filename);

    // Fetch blob from DB on demand
    const db = dbRef.current;
    if (!db) return undefined;

    const result = getMediaBlobByFilename(db, filename);
    if (!result.success || !result.data) return getBundledPaintingUrl(deckId, filename);

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
  }, [deckId]);

  const addMediaFile = useCallback((filename: string, url: string) => {
    knownFilesRef.current.add(filename);
    urlCacheRef.current.set(filename, url);
  }, []);

  const rewriteHtml = useCallback(
    (html: string): string => {
      // Build a lazy proxy map that resolves URLs on demand
      const proxyMap: ReadonlyMap<string, string> = {
        get size() { return knownFilesRef.current.size + getBundledPaintingFiles(deckId).length; },
        get(key: string) { return resolveUrl(key); },
        has(key: string) { return knownFilesRef.current.has(key); },
        forEach() { /* not used by rewriteMediaUrls */ },
        entries() { return (new Map<string, string>()).entries(); },
        keys() { return knownFilesRef.current.keys(); },
        values() { return (new Map<string, string>()).values(); },
        [Symbol.iterator]() { return (new Map<string, string>())[Symbol.iterator](); },
      };
      const content = deckId === WELCOME_DECK_ID ? refreshBuiltInKitArtwork(html) : html;
      return loading ? content : rewriteMediaUrls(content, proxyMap);
    },
    [resolveUrl, deckId, loading],
  );

  return { rewriteHtml, loading, addMediaFile };
}
