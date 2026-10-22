import { useEffect, useRef } from 'react';
import type { InlineConfirmationProps } from '../types/editorUi';

/** A reversible decision in the current working area, without another modal.
 * @param props - Clear consequence, safe exit and explicit destructive action.
 * @returns A compact inline confirmation that initially focuses the safe action.
 */
export function InlineConfirmation({ title, detail, confirmLabel, cancelLabel = 'Cancel', busy = false, onConfirm, onCancel }: InlineConfirmationProps) {
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => { cancel.current?.focus(); }, []);
  return <section className="inline-confirmation" role="group" aria-label={title} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!busy) onCancel(); } }}>
    <div><p>{title}</p>{detail && <p className="inline-confirmation-detail">{detail}</p>}</div>
    <div className="inline-confirmation-actions">
      <button ref={cancel} type="button" disabled={busy} onClick={onCancel}>{cancelLabel}</button>
      <button type="button" className="inline-confirmation-destructive" disabled={busy} onClick={onConfirm}>{busy ? 'Working…' : confirmLabel}</button>
    </div>
  </section>;
}
