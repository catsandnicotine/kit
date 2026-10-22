import { describe, expect, it } from 'vitest';
import { bundledCardMediaFilename, getPastedCardFiles, hasEphemeralPastedMedia } from './cardClipboard';

function clipboard(files: File[], html = ''): DataTransfer {
  return { files, items:files.map(file => ({ kind:'file', getAsFile:() => file })), getData:() => html } as unknown as DataTransfer;
}

describe('editor media paste', () => {
  it('captures ordered photo/video files once, excluding unrelated files', () => {
    const image = new File(['photo'], 'diagram.png', { type:'image/png' });
    const movie = new File(['video'], 'lesson.mov', { type:'video/quicktime' });
    expect(getPastedCardFiles(clipboard([image, movie, new File(['x'], 'notes.pdf', { type:'application/pdf' })]))).toEqual([image, movie]);
  });
  it('accepts unnamed-mime picked media by extension and falls back to items', () => {
    const movie = new File(['video'], 'lesson.MP4');
    const data = clipboard([movie]);
    Object.assign(data, { files:[] });
    expect(getPastedCardFiles(data)).toEqual([movie]);
  });
  it('leaves ordinary text paste alone and detects clipboard-only media URLs', () => {
    expect(getPastedCardFiles(clipboard([]))).toEqual([]);
    expect(hasEphemeralPastedMedia(clipboard([], '<b>Some text</b>'))).toBe(false);
    expect(hasEphemeralPastedMedia(clipboard([], '<img src="blob:clipboard-only">'))).toBe(true);
    expect(hasEphemeralPastedMedia(clipboard([], '<video><source src="data:video/mp4;base64,AA=="></video>'))).toBe(true);
  });
  it('only resolves bundled starter artwork from the owned local path', () => {
    const deck = 'e0a57e12-0000-4000-8000-000000000001';
    expect(bundledCardMediaFilename(deck, '/decks/jesus-paintings/a%20b.jpg')).toBe('a b.jpg');
    expect(bundledCardMediaFilename(deck, 'capacitor://localhost/decks/jesus-paintings/a.jpg')).toBe('a.jpg');
    expect(bundledCardMediaFilename('other-deck', '/decks/jesus-paintings/a.jpg')).toBe('');
    expect(bundledCardMediaFilename(deck, 'https://example.com/decks/jesus-paintings/a.jpg')).toBe('');
    expect(bundledCardMediaFilename(deck, '/decks/jesus-paintings/other%2Fa.jpg')).toBe('');
    expect(bundledCardMediaFilename(deck, '/decks/jesus-paintings/%2E%2E')).toBe('');
  });
});
