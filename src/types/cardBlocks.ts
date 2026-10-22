import type { Ref } from 'react';
import type { CardMediaKind } from './cardMedia';

export interface CardContentBlock {
  id: string;
  kind: 'text' | 'image' | 'video';
  html: string;
}

/** Imported styling is preserved independently from user-editable sections. */
export interface CardSideContent {
  metadata: string;
  blocks: CardContentBlock[];
}

export interface CardSideEditorHandle {
  getHtml: () => string;
  insertImage: (url: string) => void;
  insertMedia: (url: string, kind: CardMediaKind) => void;
  focus: () => void;
}

export interface CardSideEditorProps {
  label: 'Front' | 'Back';
  initialHtml: string;
  onChange: (html: string) => void;
  onAddImage: () => void;
  onAddFiles?: (files: File[]) => void;
  onPasteMedia?: () => void;
  onCopyMedia?: (url: string, kind: CardMediaKind) => void;
  busy?: boolean;
  visible?: boolean;
  autoFocus?: boolean;
  ref?: Ref<CardSideEditorHandle>;
}
