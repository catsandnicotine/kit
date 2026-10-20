import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ enabled: true }));
const calls = vi.hoisted(() => ({ impact: vi.fn(), notification: vi.fn() }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => native.enabled } }));
vi.mock('@capacitor/haptics', () => ({
  Haptics: calls,
  ImpactStyle: { Light: 'LIGHT', Medium: 'MEDIUM' },
  NotificationType: { Success: 'SUCCESS' },
}));

describe('contextual haptics', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    vi.clearAllMocks();
    native.enabled = true;
    calls.impact.mockResolvedValue(undefined);
    calls.notification.mockResolvedValue(undefined);
  });
  afterEach(() => { vi.useRealTimers(); });

  it('does not vibrate on module load or on the web', async () => {
    const haptics = await import('./haptics');
    expect(calls.impact).not.toHaveBeenCalled();
    native.enabled = false;
    await haptics.hapticRating('easy');
    expect(calls.impact).not.toHaveBeenCalled();
  });

  it('starts Easy immediately and finishes its double tick after 85ms', async () => {
    const { hapticRating } = await import('./haptics');
    const feedback = hapticRating('easy');
    expect(calls.impact).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(84);
    expect(calls.impact).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await feedback;
    expect(calls.impact).toHaveBeenCalledTimes(2);
    expect(calls.notification).not.toHaveBeenCalled();
  });

  it('cancels a leftover pulse when another action begins', async () => {
    const { hapticRating, hapticTap } = await import('./haptics');
    const feedback = hapticRating('easy');
    await vi.advanceTimersByTimeAsync(50);
    await hapticTap();
    await vi.runAllTimersAsync();
    await feedback;
    expect(calls.impact).toHaveBeenCalledTimes(2);
  });

  it('coalesces duplicate calls and distinguishes anvil from completion', async () => {
    const { hapticRating, hapticCelebration } = await import('./haptics');
    await hapticRating('hard');
    await hapticRating('hard');
    expect(calls.impact).toHaveBeenCalledExactlyOnceWith({ style: 'MEDIUM' });
    await vi.advanceTimersByTimeAsync(240);
    await hapticCelebration();
    expect(calls.notification).toHaveBeenCalledExactlyOnceWith({ type: 'SUCCESS' });
  });

  it('does not reject an interaction when native feedback fails', async () => {
    const { hapticTap, hapticSuccess } = await import('./haptics');
    calls.impact.mockRejectedValue(new Error('unavailable'));
    calls.notification.mockRejectedValue(new Error('unavailable'));
    await expect(hapticTap()).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(100);
    await expect(hapticSuccess()).resolves.toBeUndefined();
  });
});
