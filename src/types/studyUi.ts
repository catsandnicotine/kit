import type { ReactNode } from 'react';
import type { CardFace } from './editorUi';

export interface CardFaceIndicatorProps {
  face: CardFace;
  onFlip: () => void;
  disabled?: boolean;
  seenCount?: number | null | undefined;
}

export interface StudyFooterProps {
  face: CardFace;
  layoutFace?: CardFace;
  seenCount?: number | null | undefined;
  onFlip: () => void;
  disabled?: boolean;
  /** Keep preparing controls outside input/focus navigation without removing their layout. */
  inert?: boolean;
  frontActions: ReactNode;
  backActions: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
}
