import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveBrowserMediaBlob } from './browserMediaFiles';

describe('file-backed browser attachment writes', () => {
  const write = vi.fn();
  const close = vi.fn();
  const abort = vi.fn();
  const createWritable = vi.fn();
  const getFileHandle = vi.fn();
  const removeEntry = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
    write.mockResolvedValue(undefined); close.mockResolvedValue(undefined);
    abort.mockResolvedValue(undefined); removeEntry.mockResolvedValue(undefined);
    createWritable.mockResolvedValue({ write, close, abort });
    getFileHandle.mockRejectedValueOnce(new DOMException('Not found', 'NotFoundError'))
      .mockResolvedValue({ createWritable });
    const deck = { getFileHandle, removeEntry };
    const media = { getDirectoryHandle:vi.fn().mockResolvedValue(deck) };
    const root = { getDirectoryHandle:vi.fn().mockResolvedValue(media) };
    vi.stubGlobal('navigator', { storage:{ getDirectory:vi.fn().mockResolvedValue(root) } });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('writes the original Blob directly and waits for close', async () => {
    const file = new File(['video'], 'clip.mov', { type:'video/quicktime' });
    const readAll = vi.spyOn(file, 'arrayBuffer').mockRejectedValue(new Error('Must not materialise'));
    await saveBrowserMediaBlob('deck', 'user_clip.mov', file);
    expect(write).toHaveBeenCalledWith(file);
    expect(close).toHaveBeenCalledTimes(1);
    expect(readAll).not.toHaveBeenCalled();
    expect(removeEntry).not.toHaveBeenCalled();
  });

  it('aborts and removes only the newly created file on a failed write', async () => {
    write.mockRejectedValueOnce(new Error('Quota exceeded'));
    await expect(saveBrowserMediaBlob('deck', 'user_new.png', new Blob(['image']))).rejects.toThrow('Quota exceeded');
    expect(abort).toHaveBeenCalledTimes(1);
    expect(removeEntry).toHaveBeenCalledWith('user_new.png');
    expect(close).not.toHaveBeenCalled();
  });

  it('does not overwrite or remove a file already present in the deck', async () => {
    getFileHandle.mockReset().mockResolvedValue({ createWritable });
    await expect(saveBrowserMediaBlob('deck', 'old.png', new Blob(['image']))).rejects.toThrow('already exists');
    expect(createWritable).not.toHaveBeenCalled();
    expect(removeEntry).not.toHaveBeenCalled();
  });
});
