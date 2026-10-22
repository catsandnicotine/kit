import { beforeEach, describe, expect, it, vi } from 'vitest';
import { saveCardMedia, pasteCardMedia, copyCardMedia } from './cardMedia';
import { getMediaFileWebUrl, saveMediaBlobFile } from './mediaFiles';

const native = vi.hoisted(() => ({
  platform:'web', available:true, paste:vi.fn(), copy:vi.fn(),
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform:() => native.platform, isPluginAvailable:() => native.available, convertFileSrc:(url:string) => `converted:${url}` },
  registerPlugin:() => native,
}));
vi.mock('./mediaFiles', () => ({ getMediaFileWebUrl:vi.fn(), saveMediaBlobFile:vi.fn() }));

describe('card media attachment storage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    native.platform = 'web'; native.available = true;
    vi.mocked(getMediaFileWebUrl).mockResolvedValue('blob:saved-media');
    vi.mocked(saveMediaBlobFile).mockResolvedValue(undefined);
  });

  it('preserves the original file and selects the extension from its MIME type', async () => {
    const file = new File(['image'], 'clipboard', { type:'image/png' });
    const result = await saveCardMedia('deck-1', file);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({ filename:expect.stringMatching(/^user_[\w-]+\.png$/), url:'blob:saved-media', kind:'image' });
    expect(saveMediaBlobFile).toHaveBeenCalledWith('deck-1', result.data.filename, file);
  });

  it('stores an original video File without calling its whole-file arrayBuffer', async () => {
    const file = new File(['video'], 'lecture.mov', { type:'video/quicktime' });
    const readAll = vi.spyOn(file, 'arrayBuffer').mockRejectedValue(new Error('Whole file must not be read'));
    const result = await saveCardMedia('welcome-kit-00000000-0000-0000-0000-000000000001', file);
    expect(result.success && result.data.kind).toBe('video');
    expect(result.success && result.data.filename.endsWith('.mov')).toBe(true);
    expect(readAll).not.toHaveBeenCalled();
  });

  it('accepts a known video extension when a picker supplies no MIME type', async () => {
    const result = await saveCardMedia('deck-1', new File(['video'], 'clip.mp4'));
    expect(result.success && result.data.kind).toBe('video');
  });

  it('rejects path traversal, empty data and conflicting non-media types before storage', async () => {
    expect((await saveCardMedia('../deck', new File(['x'], 'image.png', { type:'image/png' }))).success).toBe(false);
    expect((await saveCardMedia('deck', new File([], 'empty.png', { type:'image/png' }))).success).toBe(false);
    expect((await saveCardMedia('deck', new File(['text'], 'fake.png', { type:'text/html' }))).success).toBe(false);
    expect(saveMediaBlobFile).not.toHaveBeenCalled();
  });

  it('keeps a storage failure actionable and does not resolve a broken preview', async () => {
    vi.mocked(saveMediaBlobFile).mockRejectedValueOnce(new Error('Disk full'));
    const result = await saveCardMedia('deck', new File(['video'], 'clip.mp4', { type:'video/mp4' }));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain('other changes are still here');
    expect(getMediaFileWebUrl).not.toHaveBeenCalled();
  });

  it('preserves native provider order without moving media bytes over the bridge', async () => {
    native.platform = 'ios';
    native.paste.mockResolvedValue({ items:[
      { filename:'first.mov', url:'file:///Documents/media/deck/first.mov', kind:'video' },
      { filename:'second.png', url:'file:///Documents/media/deck/second.png', kind:'image' },
    ] });
    const result = await pasteCardMedia('deck');
    expect(result.success && result.data.map(item => item.kind)).toEqual(['video', 'image']);
    expect(result.success && result.data[0]?.url).toBe('converted:file:///Documents/media/deck/first.mov');
    expect(native.paste).toHaveBeenCalledWith({ deckId:'deck' });
    expect(saveMediaBlobFile).not.toHaveBeenCalled();
  });

  it('rejects malformed native file metadata before insertion', async () => {
    native.platform = 'ios';
    native.paste.mockResolvedValue({ items:[{ filename:'../escape.mov', url:'file:///escape.mov', kind:'video' }] });
    expect((await pasteCardMedia('deck')).success).toBe(false);
  });

  it('reports native Paste refusal without touching the current card', async () => {
    native.platform = 'ios'; native.paste.mockRejectedValueOnce(new Error('Not allowed'));
    const result = await pasteCardMedia('deck');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain('Allow Paste if iOS asks');
    expect(saveMediaBlobFile).not.toHaveBeenCalled();
  });

  it('uses one best representation per browser clipboard item, in item order', async () => {
    const first = vi.fn().mockResolvedValue(new Blob(['photo'], { type:'image/png' }));
    const second = vi.fn().mockResolvedValue(new Blob(['movie'], { type:'video/mp4' }));
    vi.stubGlobal('navigator', { clipboard:{ read:vi.fn().mockResolvedValue([
      { types:['text/html', 'image/png'], getType:first },
      { types:['image/png', 'video/mp4'], getType:second },
    ]) } });
    const result = await pasteCardMedia('deck');
    expect(result.success && result.data.map(item => item.kind)).toEqual(['image', 'video']);
    expect(first).toHaveBeenCalledWith('image/png');
    expect(second).toHaveBeenCalledWith('video/mp4');
    expect(saveMediaBlobFile).toHaveBeenCalledTimes(2);
  });

  it('copies native attachments through a file provider and never reads the clipboard', async () => {
    native.platform = 'ios'; native.copy.mockResolvedValue(undefined);
    expect(await copyCardMedia('deck', 'clip.mov', 'capacitor://media/clip.mov', 'video')).toEqual({ success:true, data:undefined });
    expect(native.copy).toHaveBeenCalledWith({ deckId:'deck', filename:'clip.mov', displayUrl:'capacitor://media/clip.mov', kind:'video' });
    expect(native.paste).not.toHaveBeenCalled();
  });

  it('does not pass a traversal filename to the native copy plugin', async () => {
    native.platform = 'ios';
    expect((await copyCardMedia('deck', '../clip.mov', 'file:///clip.mov', 'video')).success).toBe(false);
    expect(native.copy).not.toHaveBeenCalled();
  });
  it('resolves root-relative bundled art before native copy', async () => {
    native.platform = 'ios'; native.copy.mockResolvedValue(undefined);
    const deckId = 'e0a57e12-0000-4000-8000-000000000001';
    expect((await copyCardMedia(deckId, 'jesus-met-436104.jpg', '/decks/jesus-paintings/jesus-met-436104.jpg', 'image')).success).toBe(true);
    expect(native.copy).toHaveBeenCalledWith({ deckId, filename:'jesus-met-436104.jpg', displayUrl:'capacitor://localhost/decks/jesus-paintings/jesus-met-436104.jpg', kind:'image' });
  });

  it('gives an honest browser video fallback without writing a fake URL', async () => {
    const write = vi.fn(); vi.stubGlobal('navigator', { clipboard:{ write } });
    const result = await copyCardMedia('deck', 'clip.mp4', 'blob:clip', 'video');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain('original video file');
    expect(write).not.toHaveBeenCalled();
  });

  it('starts a browser PNG write with a promised representation during the user action', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard:{ write } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok:true, blob:() => Promise.resolve(new Blob(['png'], { type:'image/png' })) }));
    const makeItem = vi.fn();
    vi.stubGlobal('ClipboardItem', class {
      static supports = () => true;
      constructor(data: Record<string, Promise<Blob>>) { makeItem(data); }
    });
    expect(await copyCardMedia('deck', 'photo.png', 'blob:photo', 'image')).toEqual({ success:true, data:undefined });
    expect(makeItem).toHaveBeenCalledWith({ 'image/png':expect.any(Promise) });
    expect(write).toHaveBeenCalledTimes(1);
  });
});
