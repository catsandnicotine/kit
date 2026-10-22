import { describe, expect, it } from 'vitest';
import { pauseNoticeClock, remainingNoticeTime, resumeNoticeClock } from './noticeTiming';

describe('notice reading time', () => {
  it('pauses while reading without consuming time or restarting the full delay', () => {
    const running = resumeNoticeClock({ remainingMs: 4000, runningSince: null }, 100);
    const paused = pauseNoticeClock(running, 1100);
    expect(remainingNoticeTime(paused, 30_000)).toBe(3000);
    const resumed = resumeNoticeClock(paused, 30_000);
    expect(remainingNoticeTime(resumed, 32_999)).toBe(1);
    expect(remainingNoticeTime(resumed, 33_000)).toBe(0);
  });

  it('does not extend a running message when the same state is reported again', () => {
    const running = { remainingMs: 9000, runningSince: 100 };
    expect(resumeNoticeClock(running, 5100)).toBe(running);
    expect(remainingNoticeTime(running, 5100)).toBe(4000);
  });

  it('keeps an expired notice expired across further pauses', () => {
    const expired = pauseNoticeClock({ remainingMs: 4000, runningSince: 0 }, 6000);
    expect(remainingNoticeTime(resumeNoticeClock(expired, 7000), 8000)).toBe(0);
  });
});
