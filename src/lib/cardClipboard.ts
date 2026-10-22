/** Capture media Files during the paste event, before Safari releases its data store.
 * @param clipboard - The user-initiated paste event's data.
 * @returns Ordered photos/videos; ordinary text paste remains native.
 */
export function getPastedCardFiles(clipboard: DataTransfer): File[] {
  const files = clipboard.files.length ? [...clipboard.files]
    : [...clipboard.items].filter(item => item.kind === 'file').map(item => item.getAsFile()).filter((file): file is File => file !== null);
  return files.filter(file => /^(?:image|video)\//i.test(file.type)
    || /\.(?:png|jpe?g|gif|webp|svg|heic|heif|avif|mp4|mov|m4v|webm)$/i.test(file.name));
}

/** Avoid saving clipboard-only blob/data URLs as if they were durable card attachments.
 * @param clipboard - The current paste event's data.
 * @returns Whether the explicit media-paste path should own this paste.
 */
export function hasEphemeralPastedMedia(clipboard: DataTransfer): boolean {
  return /<(?:img|video|source)\b[^>]*\bsrc\s*=\s*["'](?:data:|blob:)/i.test(clipboard.getData('text/html'));
}

/** Identify the owned starter art when it has no imported-media reverse mapping.
 * @param deckId - Current deck owner.
 * @param displayUrl - Relative or local preview URL from the editor's media block.
 * @returns Its safe single-segment bundled filename, or an empty string.
 */
export function bundledCardMediaFilename(deckId: string, displayUrl: string): string {
  if (deckId !== 'e0a57e12-0000-4000-8000-000000000001') return '';
  try {
    const url = new URL(displayUrl, 'http://localhost');
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || !['http:', 'https:', 'capacitor:'].includes(url.protocol)) return '';
    const filename = decodeURIComponent(url.pathname.replace(/^\/decks\/jesus-paintings\//, ''));
    const unsafe = /[\\/]/.test(filename) || [...filename].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
    return url.pathname.startsWith('/decks/jesus-paintings/') && !!filename && filename !== '.' && filename !== '..' && !unsafe ? filename : '';
  } catch { return ''; }
}
