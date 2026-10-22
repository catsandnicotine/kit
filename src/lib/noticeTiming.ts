import type { NoticeClock } from '../types/noticeTiming';

/** Get a notice's unused reading time, excluding any paused period.
 * @param clock - The current reading-time budget.
 * @param now - Monotonic milliseconds.
 * @returns Remaining milliseconds, bounded at zero.
 */
export function remainingNoticeTime(clock: NoticeClock, now: number): number {
  return Math.max(0, clock.remainingMs - (clock.runningSince === null ? 0 : Math.max(0, now - clock.runningSince)));
}

/** Stop a reading timer without discarding its remaining time.
 * @param clock - The current reading-time budget.
 * @param now - Monotonic milliseconds.
 * @returns A paused clock retaining only its unused time.
 */
export function pauseNoticeClock(clock: NoticeClock, now: number): NoticeClock {
  return { remainingMs: remainingNoticeTime(clock, now), runningSince: null };
}

/** Resume a paused reading timer without restarting its full delay.
 * @param clock - The paused reading-time budget.
 * @param now - Monotonic milliseconds.
 * @returns A running clock; an already running clock stays unchanged.
 */
export function resumeNoticeClock(clock: NoticeClock, now: number): NoticeClock {
  return clock.runningSince === null ? { ...clock, runningSince: now } : clock;
}
