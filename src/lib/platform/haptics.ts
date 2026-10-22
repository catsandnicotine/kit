/** Contextual, bounded feedback. Native failures must never interrupt studying. */
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import type { Rating } from '../../types';
import type { LibrarySwipeHapticFeedback } from '../../types/haptics';

let generation = 0;
let lastStarted = -Infinity;
let selectionBusy = false;

function available(): boolean {
  return Capacitor.isNativePlatform() && (typeof document === 'undefined' || document.visibilityState !== 'hidden');
}

async function impact(style: ImpactStyle): Promise<void> {
  try { await Haptics.impact({ style }); }
  catch { /* Unsupported hardware/disabled feedback is a quiet no-op. */ }
}

async function selectionTick(token: number): Promise<void> {
  const requestedAt = Date.now();
  if (token !== generation || !available() || selectionBusy || requestedAt - lastStarted < 45) return;
  lastStarted = requestedAt;
  selectionBusy = true;
  try {
    await Haptics.selectionStart();
    // A bridge backlog must not turn old finger feedback into a late pulse.
    if (token !== generation || !available() || Date.now() - requestedAt > 45) return;
    await Haptics.selectionChanged();
  } catch { /* Optional detents must never block or reject navigation. */ }
  finally {
    try { await Haptics.selectionEnd(); }
    catch { /* End preparation quietly even when feedback is unsupported. */ }
    selectionBusy = false;
  }
}

async function swipeImpact(token: number): Promise<void> {
  const requestedAt = Date.now();
  if (token !== generation || !available() || requestedAt - lastStarted < 45) return;
  lastStarted = requestedAt;
  // Dispatch immediately: no queued preparation can outlive this gesture.
  await impact(ImpactStyle.Light);
}

/** Scope quiet library detents to one drag and the existing visual landing.
 * @returns Optional lift/threshold/landing ticks; newer feedback cancels this scope.
 */
export function createLibrarySwipeHaptics(): LibrarySwipeHapticFeedback {
  const token = ++generation;
  const cancel = () => { if (token === generation) ++generation; };
  return {
    lift: () => swipeImpact(token),
    threshold: () => selectionTick(token),
    land: async () => { await swipeImpact(token); cancel(); },
    cancel,
  };
}

// New interactions cancel any remaining pulses; rapid duplicate calls coalesce.
async function play(styles: readonly ImpactStyle[], gap = 65): Promise<void> {
  const token = ++generation;
  if (!available() || Date.now() - lastStarted < 45) return;
  lastStarted = Date.now();
  for (const [i, style] of styles.entries()) {
    if (i > 0) await new Promise(resolve => setTimeout(resolve, gap));
    if (token !== generation || !available()) return;
    await impact(style);
  }
}

/** Reveal: one light, immediate click. @returns Feedback completion. */
export function hapticFlip(): Promise<void> {
  return play([ImpactStyle.Light]);
}

/** Return/retry without an error alarm. @returns Feedback completion. */
export function hapticAgain(): Promise<void> {
  return play([ImpactStyle.Light, ImpactStyle.Light], 55);
}

/** Match the selected pixel symbol, at the start of its drawing.
 * @param rating - Honest recall rating; never amplified by a streak.
 * @returns Feedback completion.
 */
export function hapticRating(rating: Rating): Promise<void> {
  if (rating === 'again') return hapticAgain();
  if (rating === 'hard') return play([ImpactStyle.Medium]);
  if (rating === 'easy') return play([ImpactStyle.Light, ImpactStyle.Light], 85);
  return play([ImpactStyle.Light]);
}

/** Match the physical-card review action.
 * @param choice - Return the card or finish with it.
 * @returns Feedback completion.
 */
export function hapticReviewChoice(choice: 'again' | 'aside'): Promise<void> {
  return choice === 'again' ? hapticAgain() : play([ImpactStyle.Light]);
}

/** A successfully completed task, reserved for real milestones. @returns Feedback completion. */
export async function hapticSuccess(): Promise<void> {
  ++generation;
  if (!available() || Date.now() - lastStarted < 45) return;
  lastStarted = Date.now();
  try { await Haptics.notification({ type: NotificationType.Success }); }
  catch { /* Haptics are optional; task completion still succeeds. */ }
}

/** Completed session/import: one native success cadence. @returns Feedback completion. */
export async function hapticCelebration(): Promise<void> {
  const token = ++generation;
  const pause = Math.max(0, 160 - (Date.now() - lastStarted));
  if (pause > 0) await new Promise(resolve => setTimeout(resolve, pause));
  if (token !== generation || !available()) return;
  await hapticSuccess();
}

/** Long-press activation: a light confirmation. @returns Feedback completion. */
export function hapticLongPress(): Promise<void> {
  return play([ImpactStyle.Light]);
}

/** Undo: quiet acknowledgement. @returns Feedback completion. */
export function hapticUndo(): Promise<void> {
  return play([ImpactStyle.Light]);
}

/** Routine control: a single light tick. @returns Feedback completion. */
export function hapticTap(): Promise<void> {
  return play([ImpactStyle.Light]);
}

/** Navigation stays quieter than substantive actions. @returns Feedback completion. */
export function hapticNavigate(): Promise<void> {
  return play([ImpactStyle.Light]);
}
