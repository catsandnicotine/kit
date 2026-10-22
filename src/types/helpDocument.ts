export type HelpPage = 'privacy' | 'support';

export type HelpDocumentState =
  | { status: 'idle' }
  | { status: 'loading'; page: HelpPage }
  | { status: 'ready'; page: HelpPage; html: string }
  | { status: 'error'; page: HelpPage };
