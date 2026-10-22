import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NativeLibraryEvent, NativeLibraryState } from '../../types/nativeLibraryControls';

const native = vi.hoisted(() => ({
  platform: 'ios', available: true,
  setState: vi.fn().mockResolvedValue(undefined),
  addListener: vi.fn(), remove: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => native.platform, isPluginAvailable: () => native.available },
  registerPlugin: () => native,
}));
import { createLibraryControls } from './libraryControls';

const state: NativeLibraryState = { visible:true, searchOpen:false, searchQuery:'', addDisabled:false, appearance:'dark' };

describe('native library ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    native.platform = 'ios'; native.available = true;
    native.setState.mockResolvedValue(undefined);
    native.addListener.mockResolvedValue({ remove:native.remove });
  });

  it('keeps browser and unregistered development builds on their web controls', () => {
    native.platform = 'web';
    expect(createLibraryControls(vi.fn())).toBeNull();
    native.platform = 'ios'; native.available = false;
    expect(createLibraryControls(vi.fn())).toBeNull();
    expect(native.addListener).not.toHaveBeenCalled();
  });

  it('releases the old route before showing a new route, including a repeated cleanup', async () => {
    const first = createLibraryControls(vi.fn())!;
    await first.update(state);
    const cleanup = first.dispose();
    const next = createLibraryControls(vi.fn())!;
    await next.update(state);
    await first.dispose();
    await cleanup;
    const writes = native.setState.mock.calls.map(([value]) => value);
    expect(writes.map(value => value.visible)).toEqual([true, false, true]);
    expect(writes[0].session).not.toBe(writes[2].session);
    expect(native.remove).toHaveBeenCalledTimes(1);
    await next.dispose();
  });

  it('ignores actions from disposed controls and from another screen', async () => {
    const action = vi.fn();
    const control = createLibraryControls(action)!;
    await control.update(state);
    const session = native.setState.mock.calls[0]![0].session as string;
    const dispatch = native.addListener.mock.calls[0]![1] as (event:NativeLibraryEvent) => void;
    dispatch({ session:'other-screen', action:'add' });
    dispatch({ session, action:'search', open:true, query:'' });
    await control.dispose();
    dispatch({ session, action:'settings' });
    expect(action.mock.calls).toEqual([[{ session, action:'search', open:true, query:'' }]]);
  });

  it('falls back when the bridge rejects rather than leaving an empty dock', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    native.setState.mockRejectedValueOnce(new Error('Bridge unavailable'));
    const control = createLibraryControls(vi.fn())!;
    expect(await control.update(state)).toBe(false);
    await control.dispose();
    expect(native.remove).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });

  it('delivers input and keyboard transitions only to their owning library', async () => {
    const action = vi.fn();
    const control = createLibraryControls(action)!;
    await control.update(state);
    const session = native.setState.mock.calls[0]![0].session as string;
    const dispatch = native.addListener.mock.calls[0]![1] as (event:NativeLibraryEvent) => void;
    dispatch({ session, action:'search', open:true, query:'' });
    dispatch({ session, action:'query', query:'biology' });
    dispatch({ session, action:'search', open:false, query:'biology' });
    dispatch({ session, action:'keyboard', inset:336, duration:250 });
    await control.dispose();
    dispatch({ session, action:'keyboard', inset:0, duration:250 });
    expect(action.mock.calls).toEqual([
      [{ session, action:'search', open:true, query:'' }],
      [{ session, action:'query', query:'biology' }],
      [{ session, action:'search', open:false, query:'biology' }],
      [{ session, action:'keyboard', inset:336, duration:250 }],
    ]);
  });
});
