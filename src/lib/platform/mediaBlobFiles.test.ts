import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Filesystem } from '@capacitor/filesystem';
import { saveMediaBlobFile } from './mediaFiles';
import { saveBrowserMediaBlob } from './browserMediaFiles';
import { isNativePlatform } from './platformDetect';

vi.mock('@capacitor/filesystem', () => ({
  Directory:{ Documents:'DOCUMENTS' },
  Filesystem:{ mkdir:vi.fn(), readdir:vi.fn(), writeFile:vi.fn(), appendFile:vi.fn(), deleteFile:vi.fn() },
}));
vi.mock('@capacitor/core', () => ({ Capacitor:{ convertFileSrc:(url:string) => url } }));
vi.mock('./platformDetect', () => ({ isNativePlatform:vi.fn() }));
vi.mock('./browserMediaFiles', () => ({ saveBrowserMediaBlob:vi.fn() }));

describe('bounded attachment file writes', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(isNativePlatform).mockReturnValue(true);
    vi.mocked(Filesystem.mkdir).mockResolvedValue(undefined);
    vi.mocked(Filesystem.readdir).mockResolvedValue({ files:[] });
    vi.mocked(Filesystem.writeFile).mockResolvedValue({ uri:'file:///new' });
    vi.mocked(Filesystem.appendFile).mockResolvedValue(undefined);
    vi.mocked(Filesystem.deleteFile).mockResolvedValue(undefined);
  });

  it('writes a large Blob as exact bounded base64 chunks, not one whole-file buffer', async () => {
    const bytes = new Uint8Array(512 * 1024 + 17);
    bytes.fill(42); bytes[bytes.length - 1] = 91;
    const blob = new Blob([bytes]);
    const whole = vi.spyOn(blob, 'arrayBuffer').mockRejectedValue(new Error('Must use slices'));
    await saveMediaBlobFile('deck', 'user_video.mp4', blob);
    expect(whole).not.toHaveBeenCalled();
    const first = vi.mocked(Filesystem.writeFile).mock.calls[0]![0];
    const last = vi.mocked(Filesystem.appendFile).mock.calls[0]![0];
    expect(atob(first.data as string)).toHaveLength(512 * 1024);
    expect(atob(last.data)).toHaveLength(17);
    expect(atob(last.data).charCodeAt(16)).toBe(91);
    expect(first.path).toBe('media/deck/user_video.mp4');
  });

  it('tolerates the known existing-directory result before writing another attachment', async () => {
    vi.mocked(Filesystem.mkdir).mockRejectedValueOnce({ code:'OS-PLUG-FILE-0010' });
    await saveMediaBlobFile('deck', 'new.png', new Blob(['x']));
    expect(Filesystem.writeFile).toHaveBeenCalledTimes(1);
  });

  it('refuses to overwrite an existing file and never deletes it', async () => {
    vi.mocked(Filesystem.readdir).mockResolvedValue({ files:[{ name:'existing.png', type:'file', size:1, ctime:0, mtime:0, uri:'file:///existing' }] });
    await expect(saveMediaBlobFile('deck', 'existing.png', new Blob(['new']))).rejects.toThrow('already exists');
    expect(Filesystem.writeFile).not.toHaveBeenCalled();
    expect(Filesystem.deleteFile).not.toHaveBeenCalled();
  });

  it('removes only its new partial file when a later chunk fails', async () => {
    vi.mocked(Filesystem.appendFile).mockRejectedValueOnce(new Error('Disk full'));
    await expect(saveMediaBlobFile('deck', 'user_partial.mp4', new Blob([new Uint8Array(600000)]))).rejects.toThrow('Disk full');
    expect(Filesystem.deleteFile).toHaveBeenCalledWith({ path:'media/deck/user_partial.mp4', directory:'DOCUMENTS' });
  });

  it('rejects invalid storage paths before any native call', async () => {
    await expect(saveMediaBlobFile('../deck', 'x.png', new Blob(['x']))).rejects.toThrow('Invalid media location');
    await expect(saveMediaBlobFile('deck', '../x.png', new Blob(['x']))).rejects.toThrow('Invalid media location');
    expect(Filesystem.mkdir).not.toHaveBeenCalled();
  });

  it('hands the original Blob to OPFS instead of materialising browser video bytes', async () => {
    vi.mocked(isNativePlatform).mockReturnValue(false);
    const blob = new Blob(['video']);
    await saveMediaBlobFile('deck', 'video.mp4', blob);
    expect(saveBrowserMediaBlob).toHaveBeenCalledWith('deck', 'video.mp4', blob);
    expect(Filesystem.writeFile).not.toHaveBeenCalled();
  });
});
