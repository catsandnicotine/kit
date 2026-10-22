import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from 'sql.js';
import type { DeckMediaBootstrap, UseDeckMediaReturn } from '../types/deckMedia';
import { useDeckMedia } from './useDeckMedia';
import { getMediaBlobByFilename, getMediaFilenames } from '../lib/db/queries';
import { getMediaDirUri, listMediaFilenames } from '../lib/platform/mediaFiles';

const runtime = vi.hoisted(() => ({ cursor:0, slots:[] as unknown[], effects:[] as (() => void)[], changed:false, native:true }));

vi.mock('react', () => {
  const unchanged = (first: readonly unknown[], second: readonly unknown[]) => first.length === second.length && first.every((value, index) => Object.is(value, second[index]));
  return {
    useState<T>(initial: T | (() => T)) {
      const index = runtime.cursor++;
      if (!(index in runtime.slots)) runtime.slots[index] = typeof initial === 'function' ? (initial as () => T)() : initial;
      return [runtime.slots[index] as T, (next: T | ((previous: T) => T)) => {
        const value = typeof next === 'function' ? (next as (previous: T) => T)(runtime.slots[index] as T) : next;
        if (!Object.is(value, runtime.slots[index])) { runtime.slots[index] = value; runtime.changed = true; }
      }];
    },
    useRef<T>(initial: T) {
      const index = runtime.cursor++;
      if (!(index in runtime.slots)) runtime.slots[index] = { current:initial };
      return runtime.slots[index] as { current:T };
    },
    useCallback<T>(value: T, deps: readonly unknown[]) {
      const index = runtime.cursor++;
      const previous = runtime.slots[index] as { value:T; deps:readonly unknown[] } | undefined;
      if (previous && unchanged(previous.deps, deps)) return previous.value;
      runtime.slots[index] = { value, deps };
      return value;
    },
    useLayoutEffect(effect: () => void | (() => void), deps: readonly unknown[]) {
      const index = runtime.cursor++;
      const previous = runtime.slots[index] as { deps:readonly unknown[]; cleanup?:() => void } | undefined;
      if (previous && unchanged(previous.deps, deps)) return;
      runtime.effects.push(() => {
        previous?.cleanup?.();
        runtime.slots[index] = { deps, cleanup:effect() };
      });
    },
  };
});
vi.mock('../lib/platform/platformDetect', () => ({ isNativePlatform:() => runtime.native }));
vi.mock('../lib/platform/mediaFiles', () => ({
  listMediaFilenames:vi.fn(), getMediaDirUri:vi.fn(), getMediaFileWebUrl:vi.fn(),
  mediaUriToWebUrl:(uri: string, filename: string) => `capacitor://${uri}/${encodeURIComponent(filename)}`,
}));
vi.mock('../lib/db/queries', () => ({ getMediaFilenames:vi.fn(), getMediaBlobByFilename:vi.fn() }));
vi.mock('../lib/kitCat', () => ({ refreshBuiltInKitArtwork:(html: string) => html }));
vi.mock('../lib/jesusPaintingAssets', () => ({ getBundledPaintingFiles:() => [], getBundledPaintingUrl:() => undefined }));

const db = {} as Database;
const bootstrap: DeckMediaBootstrap = { deckId:'deck-a', filenames:['photo one.jpg'], dirUri:'file:///media/deck-a' };
const settle = () => new Promise<void>(resolve => setTimeout(resolve, 0));

function render(deckId = 'deck-a', metadata: DeckMediaBootstrap | null = bootstrap): UseDeckMediaReturn {
  let result!: UseDeckMediaReturn;
  do {
    runtime.changed = false;
    runtime.cursor = 0;
    // eslint-disable-next-line react-hooks/rules-of-hooks -- This mock runtime drains separate layout-triggered renders before its simulated paint.
    result = useDeckMedia(db, deckId, metadata);
    for (const effect of runtime.effects.splice(0)) effect();
  } while (runtime.changed);
  return result;
}

function unmount() {
  for (const slot of runtime.slots) {
    if (typeof slot === 'object' && slot !== null && 'cleanup' in slot && typeof slot.cleanup === 'function') slot.cleanup();
  }
}

describe('native media navigation handoff', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    runtime.cursor = 0; runtime.slots = []; runtime.effects = []; runtime.changed = false; runtime.native = true;
    vi.mocked(listMediaFilenames).mockResolvedValue(['other.jpg']);
    vi.mocked(getMediaDirUri).mockResolvedValue('file:///media/deck-b');
    vi.mocked(getMediaFilenames).mockReturnValue({ success:true, data:new Set(['legacy.png']) });
    vi.mocked(getMediaBlobByFilename).mockReturnValue({ success:true, data:{ filename:'legacy.png', data:new Uint8Array([1, 2]), mimeType:'image/png' } });
  });

  it('consumes matching metadata during layout without another native lookup', () => {
    const media = render();
    expect(media.loading).toBe(false);
    expect(media.rewriteHtml('<img src="photo one.jpg">')).toContain('capacitor://file:///media/deck-a/photo%20one.jpg');
    expect(listMediaFilenames).not.toHaveBeenCalled();
    expect(getMediaDirUri).not.toHaveBeenCalled();
    expect(getMediaFilenames).toHaveBeenCalledExactlyOnceWith(db);
  });

  it('ignores another deck’s metadata and completes the existing asynchronous lookup', async () => {
    expect(render('deck-b').loading).toBe(true);
    expect(listMediaFilenames).toHaveBeenCalledExactlyOnceWith('deck-b');
    expect(getMediaDirUri).toHaveBeenCalledExactlyOnceWith('deck-b');
    await settle();
    const media = render('deck-b');
    expect(media.loading).toBe(false);
    expect(media.rewriteHtml('<img src="other.jpg">')).toContain('capacitor://file:///media/deck-b/other.jpg');
    expect(media.rewriteHtml('<img src="photo one.jpg">')).not.toContain('deck-a');
  });

  it('keeps legacy lazy blobs and new attachments usable, revoking only blob URLs on cleanup', () => {
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:legacy');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const media = render();
    expect(media.rewriteHtml('<img src="legacy.png">')).toContain('blob:legacy');
    expect(create).toHaveBeenCalledTimes(1);
    media.addMediaFile('new.png', 'blob:new');
    media.addMediaFile('native.png', 'capacitor://native');
    expect(media.rewriteHtml('<img src="new.png">')).toContain('blob:new');
    unmount();
    expect(revoke.mock.calls).toEqual([['blob:legacy'], ['blob:new']]);
    create.mockRestore(); revoke.mockRestore();
  });

  it('exits loading on an unexpected fallback failure and reports it', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(listMediaFilenames).mockRejectedValue(new Error('Storage locked'));
    expect(render('deck-a', null).loading).toBe(true);
    await settle();
    expect(render('deck-a', null).loading).toBe(false);
    expect(warning).toHaveBeenCalled();
    warning.mockRestore();
  });
});
