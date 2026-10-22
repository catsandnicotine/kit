import type { LibraryNotice, LibraryNoticeInput } from '../types/libraryNotice';

function errorNotice(source: LibraryNotice['source'], title: string, raw: string, fallback: string): LibraryNotice {
  const cleaned = raw.replace(/^(?:(?:Import|Export) failed(?: unexpectedly)?:\s*|Error:\s*)+/i, '').trim();
  const technical = /(?:ErrorDomain|\bCode\s*=|\berrno\b|\b(?:TypeError|SyntaxError|ReferenceError|DOMException)\b|\bat \S+\s*\(|https?:\/\/|capacitor:\/\/|\b[A-Z_]{4,}\b|[{}])/;
  const message = /(?:ENOSPC|disk (?:is )?full|out of (?:disk )?space|not enough (?:disk )?(?:space|storage)|Code\s*=\s*640\b)/i.test(raw)
    ? 'Free some space on your device, then try again.'
    : cleaned && cleaned.length <= 180 && !technical.test(cleaned) ? cleaned : fallback;
  return { source, tone: 'error', title, message, details: raw.trim() !== message ? raw.trim() : '' };
}

/** Choose one visible library notice, prioritizing failures over routine activity.
 * @param input - Current library, import, export, and media-restoration states.
 * @returns A plain-language notice with optional diagnostics, or no notice.
 */
export function getLibraryNotice(input: LibraryNoticeInput): LibraryNotice | null {
  if (input.libraryError) return errorNotice('library', 'Couldn’t open library', input.libraryError, 'Reopen Kit to try again.');
  if (input.importNotice?.type === 'error') return errorNotice('import', 'Couldn’t import deck', input.importNotice.message, 'Choose an Anki .apkg file and try again.');
  if (input.exportPhase === 'error') return errorNotice('export', 'Couldn’t export deck', input.exportError, 'Try sharing the deck again.');
  if (input.mediaPhase === 'error') return errorNotice('media', 'Couldn’t restore media', input.mediaMessage ?? '', 'Choose this deck’s original Anki file and try again.');
  if (input.mediaPhase === 'working') return { source: 'media', tone: 'progress', title: 'Restoring media', message: '', details: '' };
  if (input.exportPhase === 'exporting') return { source: 'export', tone: 'progress', title: 'Preparing export', message: '', details: '' };
  if (input.importNotice?.type === 'success') return { source: 'import', tone: 'success', title: 'Deck imported', message: '', details: '' };
  if (input.mediaPhase === 'done') return { source: 'media', tone: 'success', title: 'Media restored', message: input.mediaMessage ?? '', details: '' };
  if (input.exportPhase === 'done') return { source: 'export', tone: 'success', title: 'Deck exported', message: '', details: '' };
  return null;
}
