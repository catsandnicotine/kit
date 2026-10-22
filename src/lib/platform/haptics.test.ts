import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ enabled: true }));
const calls = vi.hoisted(() => ({ impact: vi.fn(), notification: vi.fn(), selectionStart:vi.fn(), selectionChanged:vi.fn(), selectionEnd:vi.fn() }));
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
    calls.selectionStart.mockResolvedValue(undefined);
    calls.selectionChanged.mockResolvedValue(undefined);
    calls.selectionEnd.mockResolvedValue(undefined);
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

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

  it('dispatches light lift and landing impacts around a quieter selection threshold without extra timers', async () => {
    const { createLibrarySwipeHaptics } = await import('./haptics');
    const feedback = createLibrarySwipeHaptics();
    const lifting = feedback.lift();
    expect(calls.impact).toHaveBeenCalledExactlyOnceWith({ style:'LIGHT' });
    await lifting;
    await vi.advanceTimersByTimeAsync(50);
    await feedback.threshold();
    await vi.advanceTimersByTimeAsync(120);
    const landing = feedback.land();
    expect(calls.impact).toHaveBeenCalledTimes(2);
    await landing;
    await vi.advanceTimersByTimeAsync(50);
    await feedback.threshold();
    expect(calls.selectionChanged).toHaveBeenCalledTimes(1);
    expect(calls.selectionStart).toHaveBeenCalledTimes(1);
    expect(calls.selectionEnd).toHaveBeenCalledTimes(1);
    expect(calls.selectionStart.mock.invocationCallOrder[0]).toBeLessThan(calls.selectionChanged.mock.invocationCallOrder[0]!);
    expect(calls.selectionChanged.mock.invocationCallOrder[0]).toBeLessThan(calls.selectionEnd.mock.invocationCallOrder[0]!);
    expect(calls.impact.mock.calls).toEqual([[{ style:'LIGHT' }], [{ style:'LIGHT' }]]);
    expect(calls.impact.mock.invocationCallOrder[0]).toBeLessThan(calls.selectionChanged.mock.invocationCallOrder[0]!);
    expect(calls.selectionChanged.mock.invocationCallOrder[0]).toBeLessThan(calls.impact.mock.invocationCallOrder[1]!);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('coalesces rapid detents instead of replaying missed ticks', async () => {
    const { createLibrarySwipeHaptics } = await import('./haptics');
    const feedback = createLibrarySwipeHaptics();
    await feedback.lift();
    await feedback.threshold();
    await vi.advanceTimersByTimeAsync(50);
    expect(calls.selectionChanged).not.toHaveBeenCalled();
    await feedback.land();
    expect(calls.selectionChanged).not.toHaveBeenCalled();
    expect(calls.impact).toHaveBeenCalledTimes(2);
  });

  it('cancels a pending landing after another interaction without cancelling that newer pattern', async () => {
    const { createLibrarySwipeHaptics, hapticRating } = await import('./haptics');
    const feedback = createLibrarySwipeHaptics();
    await feedback.lift();
    await vi.advanceTimersByTimeAsync(50);
    const rating = hapticRating('easy');
    feedback.cancel();
    await vi.advanceTimersByTimeAsync(120);
    await feedback.land();
    await rating;
    expect(calls.selectionChanged).not.toHaveBeenCalled();
    expect(calls.impact).toHaveBeenCalledTimes(3);
  });

  it('finishes native selection preparation after cancellation without playing the stale tick', async () => {
    const { createLibrarySwipeHaptics } = await import('./haptics');
    let prepared: (() => void) | undefined;
    calls.selectionStart.mockImplementationOnce(() => new Promise<void>(resolve => { prepared = resolve; }));
    const first = createLibrarySwipeHaptics();
    const pending = first.threshold();
    first.cancel();
    const second = createLibrarySwipeHaptics();
    await second.threshold();
    expect(calls.selectionStart).toHaveBeenCalledTimes(1);
    prepared?.();
    await pending;
    expect(calls.selectionChanged).not.toHaveBeenCalled();
    expect(calls.selectionEnd).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(50);
    await second.threshold();
    expect(calls.selectionChanged).toHaveBeenCalledTimes(1);
    expect(calls.selectionEnd).toHaveBeenCalledTimes(2);
  });

  it('drops a backlogged detent and quietly recovers from native failures', async () => {
    const { createLibrarySwipeHaptics } = await import('./haptics');
    let prepared: (() => void) | undefined;
    calls.selectionStart.mockImplementationOnce(() => new Promise<void>(resolve => { prepared = resolve; }));
    const feedback = createLibrarySwipeHaptics();
    const pending = feedback.threshold();
    await vi.advanceTimersByTimeAsync(50);
    prepared?.();
    await pending;
    expect(calls.selectionChanged).not.toHaveBeenCalled();
    expect(calls.selectionEnd).toHaveBeenCalledTimes(1);
    calls.selectionStart.mockRejectedValueOnce(new Error('unsupported'));
    await expect(feedback.threshold()).resolves.toBeUndefined();
    expect(calls.selectionEnd).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(50);
    calls.selectionChanged.mockRejectedValueOnce(new Error('unsupported'));
    calls.selectionEnd.mockRejectedValueOnce(new Error('unsupported'));
    await expect(feedback.threshold()).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(50);
    await expect(feedback.land()).resolves.toBeUndefined();
    expect(calls.selectionChanged).toHaveBeenCalledTimes(1);
    expect(calls.impact).toHaveBeenCalledExactlyOnceWith({ style:'LIGHT' });
  });

  it('retires pending native preparation when an unrelated interaction takes over', async () => {
    const { createLibrarySwipeHaptics, hapticTap } = await import('./haptics');
    let prepared: (() => void) | undefined;
    calls.selectionStart.mockImplementationOnce(() => new Promise<void>(resolve => { prepared = resolve; }));
    const pending = createLibrarySwipeHaptics().threshold();
    await vi.advanceTimersByTimeAsync(50);
    await hapticTap();
    prepared?.();
    await pending;
    expect(calls.impact).toHaveBeenCalledTimes(1);
    expect(calls.selectionChanged).not.toHaveBeenCalled();
    expect(calls.selectionEnd).toHaveBeenCalledTimes(1);
  });

  it('does not prepare selection feedback on the web or while hidden', async () => {
    const { createLibrarySwipeHaptics } = await import('./haptics');
    expect(calls.selectionStart).not.toHaveBeenCalled();
    native.enabled = false;
    await createLibrarySwipeHaptics().lift();
    native.enabled = true;
    vi.stubGlobal('document', { visibilityState:'hidden' });
    await createLibrarySwipeHaptics().land();
    expect(calls.selectionStart).not.toHaveBeenCalled();
    expect(calls.impact).not.toHaveBeenCalled();
  });

  it('keeps cancelled lift and landing silent and tolerates failed light feedback', async () => {
    const { createLibrarySwipeHaptics } = await import('./haptics');
    const cancelled = createLibrarySwipeHaptics();
    cancelled.cancel();
    await cancelled.lift();
    await cancelled.land();
    expect(calls.impact).not.toHaveBeenCalled();
    calls.impact.mockRejectedValue(new Error('unsupported'));
    const feedback = createLibrarySwipeHaptics();
    await expect(feedback.lift()).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(120);
    await expect(feedback.land()).resolves.toBeUndefined();
    expect(calls.impact).toHaveBeenCalledTimes(2);
  });
});
