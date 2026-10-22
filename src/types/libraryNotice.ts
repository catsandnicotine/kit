/** An operation's presentation state, separate from its detailed diagnostics. */
export type LibraryOperationPhase = 'idle' | 'working' | 'done' | 'error';

export interface LibraryNoticeInput {
  libraryError: string;
  importNotice: { type: 'success' | 'error'; message: string } | null;
  exportPhase: 'idle' | 'exporting' | 'done' | 'error';
  exportError: string;
  mediaPhase: LibraryOperationPhase;
  mediaMessage: string | null;
}

export interface LibraryNotice {
  source: 'library' | 'import' | 'export' | 'media';
  tone: 'error' | 'progress' | 'success';
  title: string;
  message: string;
  details: string;
}
