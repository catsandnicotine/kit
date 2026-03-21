/**
 * File picker abstraction — uses HTML <input type="file"> which on
 * iOS/WKWebView shows the native document picker (Files + iCloud Drive).
 */

/**
 * Pick an .apkg file from the device.
 *
 * Uses HTML file input which on iOS shows the native Files picker
 * (including iCloud Drive). Broad accept types ensure .apkg files
 * (ZIP archives) aren't filtered out.
 *
 * @returns The selected File, or null if the user cancelled.
 */
export async function pickApkgFile(): Promise<File | null> {
  // Use HTML file input on all platforms — WKWebView's built-in document
  // picker already shows iCloud Drive and Files natively. The native
  // @capawesome/capacitor-file-picker plugin has issues reading .apkg
  // files from iCloud Drive, so we bypass it entirely.
  // Use broad accept to prevent iOS from filtering out .apkg files.
  return pickFileViaInput('.apkg,.colpkg,.zip,application/zip,application/octet-stream');
}

/**
 * Pick an image file for deck thumbnails.
 *
 * Always uses HTML file input with accept="image/*" which shows
 * the camera roll / photo library on iOS (not the Files picker).
 *
 * @returns The selected File, or null if the user cancelled.
 */
export async function pickImageFile(): Promise<File | null> {
  return pickFileViaInput('image/*');
}

/**
 * Internal helper — create a hidden <input type="file"> and resolve
 * with the chosen File.
 *
 * @param accept - The accept attribute value.
 * @returns The selected File, or null if the user cancelled.
 */
function pickFileViaInput(accept: string): Promise<File | null> {
  return new Promise<File | null>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    input.addEventListener('change', () => {
      const file = input.files?.[0] ?? null;
      document.body.removeChild(input);
      resolve(file);
    });
    input.addEventListener('cancel', () => {
      document.body.removeChild(input);
      resolve(null);
    });
    document.body.appendChild(input);
    input.click();
  });
}
