import { describe, expect, it } from 'vitest';
import { getLibraryNotice } from './libraryNotice';
import type { LibraryNoticeInput } from '../types/libraryNotice';

const idle: LibraryNoticeInput = { libraryError: '', importNotice: null, exportPhase: 'idle', exportError: '', mediaPhase: 'idle', mediaMessage: null };

describe('library notices', () => {
  it('keeps a healthy idle library quiet', () => {
    expect(getLibraryNotice(idle)).toBeNull();
  });
  it('keeps native error codes in details and gives a useful storage action', () => {
    const raw = 'Error Domain=NSCocoaErrorDomain Code=640 "The disk is full."';
    const notice = getLibraryNotice({ ...idle, exportPhase: 'error', exportError: raw });
    expect(notice).toMatchObject({ tone: 'error', source: 'export', title: 'Couldn’t export deck', message: 'Free some space on your device, then try again.', details: raw });
  });
  it('uses a calm summary for technical import diagnostics', () => {
    const raw = 'Import failed unexpectedly: TypeError: read failed at parseDeck (capacitor://localhost/app.js:42)';
    const notice = getLibraryNotice({ ...idle, importNotice: { type: 'error', message: raw } });
    expect(notice?.message).toBe('Choose an Anki .apkg file and try again.');
    expect(notice?.details).toBe(raw);
  });
  it('preserves an actionable media explanation without duplicating it in details', () => {
    const message = 'This file has no matching pictures or audio. Choose its original Anki file.';
    expect(getLibraryNotice({ ...idle, mediaPhase: 'error', mediaMessage: message })).toMatchObject({ message, details: '' });
  });
  it('shows a failure before routine progress or a success notice', () => {
    expect(getLibraryNotice({ ...idle, exportPhase: 'exporting', importNotice: { type: 'success', message: 'Imported' }, mediaPhase: 'error', mediaMessage: 'No matching media.' })?.source).toBe('media');
  });
  it('keeps fatal library failures ahead of individual operations', () => {
    expect(getLibraryNotice({ ...idle, libraryError: 'NSCocoaErrorDomain Code=260', exportPhase: 'error', exportError: 'Missing media' })).toMatchObject({ source: 'library', message: 'Reopen Kit to try again.' });
  });
  it('uses the same place for progress and completion', () => {
    expect(getLibraryNotice({ ...idle, exportPhase: 'exporting' })).toMatchObject({ source: 'export', tone: 'progress' });
    expect(getLibraryNotice({ ...idle, exportPhase: 'done' })).toMatchObject({ source: 'export', tone: 'success' });
  });
  it('keeps oversized diagnostics out of the primary message', () => {
    const raw = 'A'.repeat(400);
    expect(getLibraryNotice({ ...idle, exportPhase: 'error', exportError: raw })).toMatchObject({ message: 'Try sharing the deck again.', details: raw });
  });
});
