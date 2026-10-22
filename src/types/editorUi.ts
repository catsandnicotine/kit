import type { Database } from 'sql.js';
import type { Card } from './index';
import type { PointerEventHandler, MouseEventHandler } from 'react';

export type CardFace = 'front' | 'back';
export interface InlineConfirmationProps {
  title: string;
  detail?: string;
  confirmLabel: string;
  cancelLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}
export interface HoldToEditBindings {
  onPointerDown: PointerEventHandler<HTMLElement>;
  onPointerMove: PointerEventHandler<HTMLElement>;
  onPointerUp: PointerEventHandler<HTMLElement>;
  onPointerLeave: PointerEventHandler<HTMLElement>;
  onPointerCancel: PointerEventHandler<HTMLElement>;
  onClickCapture: MouseEventHandler<HTMLElement>;
  onContextMenu: MouseEventHandler<HTMLElement>;
}
export interface HoldToEditOptions {
  onEdit: () => void;
  disabled?: boolean;
  identity: string;
}

export interface HoldEditActionProps {
  onEdit: () => void;
  onDismiss: () => void;
  face?: CardFace;
}

export interface HoldEditPoint {
  x: number;
  y: number;
}

export interface HoldEditFeedbackProps {
  holding: boolean;
  activated: boolean;
  point: HoldEditPoint | null;
}

export interface CardEditorProps {
  db: Database | null;
  card: Card;
  /** Rewrite media references in HTML to blob: URLs for display. */
  rewriteHtml?: (html: string) => string;
  /** Called after a successful save with the updated card. */
  onSave: (updated: Card) => void;
  /** Called after a successful delete. */
  onDelete: () => void;
  /** Called when the editor is dismissed without saving. */
  onDismiss: () => void;
  /** If true, this is a new card being created (not editing existing). */
  isNew?: boolean;
  /** Open the same face that was being viewed before editing. */
  initialFace?: CardFace;
  /** Tags available in this deck — shown as toggle pills for card tagging. */
  deckTags?: import('../lib/db/queries').TagCount[];
  /**
   * Called after a user-inserted image is saved to the filesystem so the
   * caller can update its media URL cache and display the image immediately.
   */
  onMediaAdded?: (filename: string, url: string) => void;
  /** Callback to emit sync edit operations (new per-deck architecture). */
  onSyncEdit?: ((ops: import('../lib/sync/types').EditOp[]) => void) | undefined;
}
