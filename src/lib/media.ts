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
 * Handles patterns that appear in Anki-generated HTML:
 *  1. `src="filename.ext"` — images, audio, video elements
 *  2. `src='filename.ext'` — single-quoted variant
 *  3. `href="filename.ext"` — SVG <image> elements (Image Occlusion cards)
 *  4. `xlink:href="filename.ext"` — older SVG <image> elements
 *  5. `url("filename")` — CSS background-image
 *  6. `[sound:filename.ext]` — Anki's audio shorthand (converted to <audio>)
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
    /\b(src|poster)=(["'])((?:(?!\2)[^\\])*?)\2/g,
    (match: string, attribute: string, quote: string, filename: string) => {
      const url = urlMap.get(filename) ?? urlMap.get(normalizeMediaFilename(filename));
      if (url) return `${attribute}=${quote}${url}${quote}`;
      return match;
    },
  );

  // Pattern 3 & 4: href="filename" or xlink:href="filename"
  // SVG <image> elements use href (or xlink:href in older SVGs) to
  // reference the underlying image. Image Occlusion cards embed the
  // base image this way. Only rewrite bare filenames found in urlMap
  // to avoid breaking external links or anchor hrefs (#, http, etc).
  result = result.replace(
    /\b(xlink:)?href=(["'])((?:(?!\2)[^\\])*?)\2/g,
    (match: string, prefix: string | undefined, quote: string, filename: string) => {
      const url = urlMap.get(filename) ?? urlMap.get(normalizeMediaFilename(filename));
      if (url) return `${prefix ?? ''}href=${quote}${url}${quote}`;
      return match;
    },
  );

  // Pattern 5: url("filename") or url('filename') or url(filename)
  // Used by CSS background-image and image occlusion cards.
  result = result.replace(
    /\burl\((['"]?)((?:(?!\1)[^)\\])*?)\1\)/g,
    (match: string, quote: string, filename: string) => {
      const url = urlMap.get(filename) ?? urlMap.get(normalizeMediaFilename(filename));
      if (url) return `url(${quote}${url}${quote})`;
      return match;
    },
  );

  // Pattern 6: [sound:filename.ext] — Anki's audio syntax.
  // Converted to an <audio> element with controls. No autoplay attribute —
  // playback is triggered imperatively by CardContent after DOM insertion
  // so that timer-driven re-renders don't restart the audio.
  result = result.replace(
    /\[sound:([^\]]+)\]/g,
    (match: string, filename: string) => {
      const url = urlMap.get(filename) ?? urlMap.get(normalizeMediaFilename(filename));
      if (url) return `<audio src="${url}" controls preload="auto" class="anki-audio"></audio>`;
      return match;
    },
  );

  return result;
}


/** Match encoded/HTML-escaped local filenames without altering external URLs.
 * @param value - A filename as represented in card HTML.
 * @returns Its original local filename.
 */
export function normalizeMediaFilename(value: string): string {
  const unescaped = value.replace(/&amp;/gi, '&').replace(/&#(?:0*38|x0*26);/gi, '&').replace(/&quot;/gi, '"').replace(/&#(?:0*39|x0*27);/gi, "'");
  try { return decodeURIComponent(unescaped).replace(/^\.\//, ''); }
  catch { return unescaped.replace(/^\.\//, ''); }
}

/** Collect local media references used by rendered cards and their styles.
 * @param html - Card HTML, including style blocks.
 * @returns Distinct original filenames suitable for media routing and repair.
 */
export function getMediaReferences(html: string): Set<string> {
  const found = new Set<string>();
  for (const pattern of [/\b(?:src|poster|(?:xlink:)?href)\s*=\s*(["'])(.*?)\1/gi, /\burl\(\s*(["']?)(.*?)\1\s*\)/gi]) {
    for (const match of html.matchAll(pattern)) {
      const value = match[2];
      if (value && !/^(?:[a-z]+:|#|\/)/i.test(value)) found.add(normalizeMediaFilename(value));
    }
  }
  for (const match of html.matchAll(/\[sound:([^\]]+)\]/gi)) if (match[1]) found.add(normalizeMediaFilename(match[1]));
  return found;
}
