/**
 * isNativePlatform — returns true when running inside Capacitor on device.
 *
 * @returns True if Capacitor native platform is active.
 */
export function isNativePlatform(): boolean {
  try {
    return !!(
      typeof window !== 'undefined' &&
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).Capacitor?.isNativePlatform?.()
    );
  } catch {
    return false;
  }
}
