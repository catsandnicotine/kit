/**
 * Haptic feedback abstraction layer.
 * All haptic calls must go through this module.
 */

import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

// Warm the native bridge on module load so the first user-facing tap
// doesn't pay the Capacitor bridge initialisation cost (~100-300ms).
Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});

/** Card flip haptic - medium impact */
export async function hapticFlip(): Promise<void> {
  await Haptics.impact({ style: ImpactStyle.Medium });
}

/** Again rating - error notification */
export async function hapticAgain(): Promise<void> {
  await Haptics.notification({ type: NotificationType.Error });
}

/** Hard/Good/Easy ratings - success notification */
export async function hapticSuccess(): Promise<void> {
  await Haptics.notification({ type: NotificationType.Success });
}

/** Import complete - celebration (3 rapid impacts) */
export async function hapticCelebration(): Promise<void> {
  await Haptics.impact({ style: ImpactStyle.Heavy });
  await new Promise(r => setTimeout(r, 80));
  await Haptics.impact({ style: ImpactStyle.Medium });
  await new Promise(r => setTimeout(r, 80));
  await Haptics.impact({ style: ImpactStyle.Light });
}

/** Long-press edit - selection feedback */
export async function hapticLongPress(): Promise<void> {
  await Haptics.selectionStart();
}

/** Undo - soft tap */
export async function hapticUndo(): Promise<void> {
  await Haptics.impact({ style: ImpactStyle.Light });
}

/** Generic button tap - light impact */
export async function hapticTap(): Promise<void> {
  await Haptics.impact({ style: ImpactStyle.Light });
}

/** Navigation transition - medium impact */
export async function hapticNavigate(): Promise<void> {
  await Haptics.impact({ style: ImpactStyle.Medium });
}
