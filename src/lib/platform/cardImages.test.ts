import { beforeEach, describe, expect, it, vi } from 'vitest';
import { saveCardImage } from './cardImages';
import { saveMediaFile, getMediaFileWebUrl } from './mediaFiles';

vi.mock('./mediaFiles', () => ({ saveMediaFile: vi.fn(), getMediaFileWebUrl: vi.fn() }));

describe('saveCardImage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getMediaFileWebUrl).mockResolvedValue('blob:test-photo');
  });

  it('persists image bytes separately and returns a portable filename', async () => {
    const file = new File(['photo bytes'], 'diagram.png', { type: 'image/png' });
    const result = await saveCardImage('deck-1', file);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.filename).toMatch(/^user_[\w-]+\.png$/);
    expect(result.data.url).toBe('blob:test-photo');
    expect(saveMediaFile).toHaveBeenCalledWith('deck-1', result.data.filename, new TextEncoder().encode('photo bytes'));
  });

  it('rejects an empty selection or non-image without writing media', async () => {
    expect((await saveCardImage('deck-1', new File([], 'empty.png', { type: 'image/png' }))).success).toBe(false);
    expect((await saveCardImage('deck-1', new File(['text'], 'notes.txt', { type: 'text/plain' }))).success).toBe(false);
    expect(saveMediaFile).not.toHaveBeenCalled();
  });

  it('reports a failed storage write rather than adding a broken image', async () => {
    vi.mocked(saveMediaFile).mockRejectedValue(new Error('ENOSPC'));
    const result = await saveCardImage('deck-1', new File(['image'], 'photo.jpg', { type: 'image/jpeg' }));
    expect(result).toEqual({ success: false, error: 'Couldn’t save that photo. Check your device’s storage and try again.' });
    expect(getMediaFileWebUrl).not.toHaveBeenCalled();
  });

  it('reports a missing preview URL instead of silently returning', async () => {
    vi.mocked(getMediaFileWebUrl).mockResolvedValue('');
    expect(await saveCardImage('deck-1', new File(['image'], 'photo.jpg', { type: 'image/jpeg' }))).toEqual({ success: false, error: 'Couldn’t open that photo. Please try again.' });
  });
});
