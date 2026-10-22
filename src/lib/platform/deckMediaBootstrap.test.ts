import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareDeckMediaBootstrap } from './deckMediaBootstrap';
import { getMediaDirUri, listMediaFilenames } from './mediaFiles';
import { isNativePlatform } from './platformDetect';

vi.mock('./platformDetect', () => ({ isNativePlatform:vi.fn() }));
vi.mock('./mediaFiles', () => ({ listMediaFilenames:vi.fn(), getMediaDirUri:vi.fn() }));

describe('navigation-owned native media metadata', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(isNativePlatform).mockReturnValue(true);
    vi.mocked(listMediaFilenames).mockResolvedValue(['photo one.jpg', 'sound.mp3']);
    vi.mocked(getMediaDirUri).mockResolvedValue('file:///Documents/media/deck-a');
  });

  it('does no file work in browsers', async () => {
    vi.mocked(isNativePlatform).mockReturnValue(false);
    expect(await prepareDeckMediaBootstrap('deck-a')).toBeNull();
    expect(listMediaFilenames).not.toHaveBeenCalled();
    expect(getMediaDirUri).not.toHaveBeenCalled();
  });

  it('starts filenames and directory lookup together and returns only frozen copied metadata', async () => {
    let release!: (filenames: string[]) => void;
    vi.mocked(listMediaFilenames).mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const pending = prepareDeckMediaBootstrap('deck-a');
    expect(listMediaFilenames).toHaveBeenCalledExactlyOnceWith('deck-a');
    expect(getMediaDirUri).toHaveBeenCalledExactlyOnceWith('deck-a');
    const filenames = ['photo one.jpg'];
    release(filenames);
    const result = await pending;
    filenames.push('later.jpg');
    expect(result).toEqual({ deckId:'deck-a', filenames:['photo one.jpg'], dirUri:'file:///Documents/media/deck-a' });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result?.filenames)).toBe(true);
    expect(Object.keys(result!)).toEqual(['deckId', 'filenames', 'dirUri']);
  });

  it('keeps absent metadata usable without claiming image files were restored', async () => {
    vi.mocked(listMediaFilenames).mockResolvedValue([]);
    vi.mocked(getMediaDirUri).mockResolvedValue('');
    expect(await prepareDeckMediaBootstrap('deck-a')).toEqual({ deckId:'deck-a', filenames:[], dirUri:'' });
  });

  it('propagates unexpected preparation failure rather than handing off a false ready result', async () => {
    vi.mocked(listMediaFilenames).mockRejectedValue(new Error('Protected storage'));
    await expect(prepareDeckMediaBootstrap('deck-a')).rejects.toThrow('Could not prepare');
  });

  it('rejects invalid native deck paths before filesystem work', async () => {
    for (const deckId of ['', '../deck-a', '/deck-a', 'a/b']) await expect(prepareDeckMediaBootstrap(deckId)).rejects.toThrow('identify');
    expect(listMediaFilenames).not.toHaveBeenCalled();
    expect(getMediaDirUri).not.toHaveBeenCalled();
  });
});
