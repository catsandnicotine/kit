import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareSessionEntrance } from './sessionEntrance';

function rect(top = 80, height = 160, left = 24, width = 320): DOMRect {
  return { x:left, y:top, top, bottom:top + height, left, right:left + width, width, height, toJSON:() => ({}) };
}

function deferred() {
  let resolve!: () => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

class SampleImage extends EventTarget {
  complete = false;
  naturalWidth = 0;
  display = 'block';
  visibility = 'visible';
  attached = true;
  bounds = rect();
  decode = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  getBoundingClientRect() { return this.bounds; }
  getClientRects() { return this.attached ? [this.bounds] : []; }
}

function session(images: SampleImage[], viewport = rect(60, 500, 0, 400)) {
  const front = {
    ownerDocument:{ defaultView:{ innerWidth:400, innerHeight:800, getComputedStyle:(image: SampleImage) => ({ display:image.display, visibility:image.visibility }) } },
    querySelector:vi.fn(() => ({ getBoundingClientRect:() => viewport })),
    querySelectorAll:vi.fn(() => images),
  };
  const root = { querySelector:vi.fn(() => front) };
  return { root:root as unknown as HTMLDivElement, front, findFront:root.querySelector };
}

afterEach(() => { vi.useRealTimers(); });

describe('initial session image readiness', () => {
  it('releases text, complete broken images and cached images without decode support immediately', () => {
    vi.useFakeTimers();
    const cached = new SampleImage();
    cached.complete = true; cached.naturalWidth = 320;
    Object.defineProperty(cached, 'decode', { value:undefined });
    const broken = new SampleImage();
    broken.complete = true;
    const { root, findFront } = session([cached, broken]);
    const ready = vi.fn();
    prepareSessionEntrance(root, ready);
    expect(findFront).toHaveBeenCalledExactlyOnceWith('.card-turn-surface--front');
    expect(ready).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('decodes a cached visible image without an artificial minimum delay', async () => {
    vi.useFakeTimers();
    const cached = new SampleImage();
    cached.complete = true; cached.naturalWidth = 320;
    const ready = vi.fn();
    prepareSessionEntrance(session([cached]).root, ready);
    expect(cached.decode).toHaveBeenCalledTimes(1);
    expect(ready).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(ready).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds an unresolved cached decode by the same maximum entry budget', async () => {
    vi.useFakeTimers();
    const cached = new SampleImage();
    cached.complete = true; cached.naturalWidth = 320;
    const decode = deferred();
    cached.decode.mockImplementation(() => decode.promise);
    const ready = vi.fn();
    prepareSessionEntrance(session([cached]).root, ready);
    await vi.advanceTimersByTimeAsync(450);
    expect(ready).toHaveBeenCalledTimes(1);
    decode.resolve();
    await Promise.resolve();
    expect(ready).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('waits for the visible image load and decode, and treats an error as ready', async () => {
    vi.useFakeTimers();
    const photo = new SampleImage();
    const broken = new SampleImage();
    const decode = deferred();
    photo.decode.mockImplementation(() => decode.promise);
    const ready = vi.fn();
    prepareSessionEntrance(session([photo, broken]).root, ready);
    broken.dispatchEvent(new Event('error'));
    photo.naturalWidth = 320;
    photo.dispatchEvent(new Event('load'));
    expect(photo.decode).toHaveBeenCalledTimes(1);
    expect(ready).not.toHaveBeenCalled();
    decode.resolve();
    await Promise.resolve();
    expect(ready).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('skips display-none, hidden, unlaid-out and below-fold images', () => {
    vi.useFakeTimers();
    const displayNone = new SampleImage(); displayNone.display = 'none';
    const hidden = new SampleImage(); hidden.visibility = 'hidden';
    const unlaid = new SampleImage(); unlaid.attached = false;
    const below = new SampleImage(); below.bounds = rect(600);
    const toRight = new SampleImage(); toRight.bounds = rect(80, 160, 440);
    const ready = vi.fn();
    prepareSessionEntrance(session([displayNone, hidden, unlaid, below, toRight]).root, ready);
    expect(ready).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('includes an above-fold unloaded image before its intrinsic size is known', () => {
    vi.useFakeTimers();
    const image = new SampleImage(); image.bounds = rect(80, 0, 24, 0);
    const ready = vi.fn();
    prepareSessionEntrance(session([image]).root, ready);
    expect(ready).not.toHaveBeenCalled();
    image.dispatchEvent(new Event('error'));
    expect(ready).toHaveBeenCalledTimes(1);
  });

  it('waits for at most four visible pending images', () => {
    vi.useFakeTimers();
    const images = Array.from({ length:5 }, () => new SampleImage());
    const fifth = images[4]!;
    const watchFifth = vi.spyOn(fifth, 'addEventListener');
    const ready = vi.fn();
    prepareSessionEntrance(session(images).root, ready);
    for (const image of images.slice(0, 4)) image.dispatchEvent(new Event('error'));
    expect(ready).toHaveBeenCalledTimes(1);
    expect(watchFifth).not.toHaveBeenCalled();
  });

  it('releases at the maximum budget and removes listeners before late events', async () => {
    vi.useFakeTimers();
    const image = new SampleImage();
    const removed = vi.spyOn(image, 'removeEventListener');
    const ready = vi.fn();
    prepareSessionEntrance(session([image]).root, ready, 5000);
    await vi.advanceTimersByTimeAsync(449);
    expect(ready).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(ready).toHaveBeenCalledTimes(1);
    expect(removed).toHaveBeenCalledWith('load', expect.any(Function));
    expect(removed).toHaveBeenCalledWith('error', expect.any(Function));
    image.dispatchEvent(new Event('load'));
    image.dispatchEvent(new Event('error'));
    expect(ready).toHaveBeenCalledTimes(1);
    expect(image.decode).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses only the remaining entry budget after pre-entry content changes', async () => {
    vi.useFakeTimers();
    const ready = vi.fn();
    prepareSessionEntrance(session([new SampleImage()]).root, ready, 75);
    await vi.advanceTimersByTimeAsync(74);
    expect(ready).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(ready).toHaveBeenCalledTimes(1);
    const expired = vi.fn();
    prepareSessionEntrance(session([new SampleImage()]).root, expired, 0);
    expect(expired).toHaveBeenCalledTimes(1);
  });

  it('cancels listeners, timer and an unresolved decode without stale readiness', async () => {
    vi.useFakeTimers();
    const image = new SampleImage();
    const decode = deferred();
    image.decode.mockImplementation(() => decode.promise);
    const ready = vi.fn();
    const cancel = prepareSessionEntrance(session([image]).root, ready);
    image.naturalWidth = 320; image.dispatchEvent(new Event('load'));
    cancel(); cancel();
    expect(vi.getTimerCount()).toBe(0);
    decode.resolve();
    await Promise.resolve();
    image.dispatchEvent(new Event('error'));
    await vi.advanceTimersByTimeAsync(500);
    expect(ready).not.toHaveBeenCalled();
  });

  it('handles rejected or throwing decodes without blocking entry', async () => {
    vi.useFakeTimers();
    const rejected = new SampleImage();
    rejected.decode.mockRejectedValueOnce(new Error('unsupported data'));
    const thrown = new SampleImage();
    thrown.decode.mockImplementationOnce(() => { throw new Error('decode unavailable'); });
    const ready = vi.fn();
    prepareSessionEntrance(session([rejected, thrown]).root, ready);
    for (const image of [rejected, thrown]) { image.naturalWidth = 320; image.dispatchEvent(new Event('load')); }
    await Promise.resolve();
    expect(ready).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('handles completion between scanning and listener setup', async () => {
    vi.useFakeTimers();
    const image = new SampleImage();
    const add = image.addEventListener.bind(image);
    vi.spyOn(image, 'addEventListener').mockImplementation((name, listener, options) => {
      add(name, listener, options);
      if (name === 'error') { image.complete = true; image.naturalWidth = 320; }
    });
    const ready = vi.fn();
    prepareSessionEntrance(session([image]).root, ready);
    await Promise.resolve();
    expect(image.decode).toHaveBeenCalledTimes(1);
    expect(ready).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('never leaves a missing, hidden or malformed front waiting', () => {
    vi.useFakeTimers();
    const ready = vi.fn();
    prepareSessionEntrance(null, ready);
    prepareSessionEntrance(session([new SampleImage()], rect(0, 0, 0, 0)).root, ready);
    const brokenRoot = { querySelector:() => { throw new Error('removed node'); } } as unknown as HTMLDivElement;
    prepareSessionEntrance(brokenRoot, ready);
    expect(ready).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });
});
