import type { HoldEditActionProps } from '../types/editorUi';
import { UiIcon } from './UiIcon';
import { useLayoutEffect, useRef } from 'react';
import './HoldToEdit.css';

/** Offer one intentional edit after a hold, without focusing editable content.
 * @param props - Open the current face, or dismiss the offer without changing it.
 * @returns A contrasting paper action and a full-size dismissal target.
 */
export function HoldEditAction({ onEdit, onDismiss, face = 'front' }: HoldEditActionProps) {
  const dismissRef = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => { dismissRef.current?.focus({ preventScroll:true }); }, []);
  return <div className="hold-edit-strip" data-hold-edit-actions role="group" aria-label="Edit this card side" onClick={event => event.stopPropagation()} onKeyDown={event => { if (event.key !== 'Escape') event.stopPropagation(); }}>
    <button type="button" className="hold-edit-strip-action" onClick={onEdit}>
      <svg width="24" height="28" viewBox="0 0 24 28" shapeRendering="crispEdges" fill="currentColor" aria-hidden="true"><path d="M3 2h13v2h2v2h2v20H3Z" opacity=".12"/><path d="M3 2h13v2H5v20h13V6h2v20H3ZM16 4h2v2h-2Z"/>
        {face === 'front' ? <path d="M8 10h7v2H8ZM8 14h7v2H8ZM8 18h5v2H8Z" opacity=".72"/> : <><path d="M9 12h5v1h2v1h1v2h-1v1h-2v1H9v-1H7v-1H6v-2h1v-1h2Zm0 2v2h5v-2Z" opacity=".72"/><path d="M11 14h2v2h-2Z"/></>}
      </svg>
      <span>Edit this side</span>
    </button>
    <button ref={dismissRef} type="button" className="hold-edit-strip-close" aria-label="Dismiss edit actions" onClick={onDismiss}><UiIcon name="close" /></button>
  </div>;
}
