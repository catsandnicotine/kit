import type { RefObject } from 'react';
import type { CardSideEditorHandle } from './cardBlocks';

export interface EditorMediaOptions {
  deckId: string;
  frontRef: RefObject<CardSideEditorHandle | null>;
  backRef: RefObject<CardSideEditorHandle | null>;
  reverseMap: ReadonlyMap<string, string>;
  onMediaAdded?: ((filename: string, url: string) => void) | undefined;
  onError: (message: string) => void;
}
