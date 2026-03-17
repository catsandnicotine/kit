/**
 * Media URL rewriting for card HTML.
 *
 * Anki card HTML references media by bare filename (e.g. src="cat.jpg",
 * [sound:meow.mp3]). This module rewrites those references to blob: object
 * URLs so the browser can display/play them from in-memory blobs.
 *
 * This module is a pure function — no React, no DB, no side effects.
 */

/**
 * Rewrite media references in card HTML to use object URLs.
 *
 * Handles three patterns that appear in Anki-generated HTML:
 *  1. `src="filename.ext"` — images, audio, video elements
 *  2. `src='filename.ext'` — single-quoted variant
 *  3. `[sound:filename.ext]` — Anki's audio shorthand (converted to <audio>)
 *
 * Only filenames that exist in `urlMap` are rewritten; unknown references
 * are left unchanged so external URLs (https://…) pass through untouched.
 *
 * @param html   - Raw card HTML from the database.
 * @param urlMap - Map of media filename → blob: object URL.
 * @returns HTML with matching media references rewritten to object URLs.
 */
export function rewriteMediaUrls(
  html: string,
  urlMap: ReadonlyMap<string, string>,
): string {
  if (urlMap.size === 0) return html;

  let result = html;

  // Pattern 1 & 2: src="filename" or src='filename'
  // Matches src= followed by a quoted value. Only rewrites if the bare
  // filename (no path separators, no protocol) is found in urlMap.
  result = result.replace(
    /\bsrc=(["'])((?:(?!\1)[^\\])*?)\1/g,
    (match: string, quote: string, filename: string) => {
      const url = urlMap.get(filename);
      if (url) return `src=${quote}${url}${quote}`;
      return match;
    },
  );

  // Pattern 3: [sound:filename.ext] — Anki's audio syntax.
  // Converted to an <audio> element with controls. No autoplay attribute —
  // playback is triggered imperatively by CardContent after DOM insertion
  // so that timer-driven re-renders don't restart the audio.
  result = result.replace(
    /\[sound:([^\]]+)\]/g,
    (match: string, filename: string) => {
      const url = urlMap.get(filename);
      if (url) return `<audio src="${url}" controls preload="auto" class="anki-audio"></audio>`;
      return match;
    },
  );

  return result;
}
