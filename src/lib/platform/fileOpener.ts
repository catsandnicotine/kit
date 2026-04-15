/**
 * Reads a file from a native file:// URL (e.g. from iOS "Open in" or share
 * sheet) and converts it to a JS File object for the import pipeline.
 *
 * Uses Capacitor.convertFileSrc to make the native path accessible to the
 * WKWebView, then fetches the bytes.
 */

import { Capacitor } from '@capacitor/core';

/**
 * Read a file from a file:// URL delivered by iOS document interaction.
 *
 * @param fileUrl - The file:// URL string from appUrlOpen
 * @returns A File object, or null if the read failed
 */
export async function readFileFromUrl(fileUrl: string): Promise<File | null> {
  try {
    const webUrl = Capacitor.convertFileSrc(fileUrl);
    const response = await fetch(webUrl);
    if (!response.ok) return null;
    const blob = await response.blob();
    const rawName = fileUrl.split('/').pop() ?? 'import.apkg';
    const filename = decodeURIComponent(rawName);
    return new File([blob], filename, { type: 'application/octet-stream' });
  } catch {
    return null;
  }
}

/**
 * Check whether a URL is an .apkg or .colpkg file URL.
 *
 * @param url - The URL string to check
 * @returns True if the URL points to an importable deck file
 */
export function isApkgFileUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return (
    lower.startsWith('file://') &&
    (lower.endsWith('.apkg') || lower.endsWith('.colpkg'))
  );
}
