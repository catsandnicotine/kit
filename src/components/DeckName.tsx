import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNameReveal } from '../hooks/useNameReveal';

/** A single-line name with an accessible full-name dialog on hold or context menu.
 * @param props.name - Original deck name; legacy Anki separators are formatted for display only.
 * @param props.className - Typography and layout inherited from the containing screen.
 * @returns A truncating name and a modal, selectable full-name view.
 */
export function DeckName({ name, className = '' }: { name:string; className?:string }) {
  const reveal = useNameReveal();
  const dialog = useRef<HTMLDialogElement>(null);
  const backdropPressed = useRef(false);
  const display = name.split(String.fromCharCode(31)).join(' / ').replace(/::/g, ' / ').replace(/\s+/g, ' ').trim();
  useEffect(() => {
    if (reveal.open) dialog.current?.showModal();
  }, [reveal.open]);
  return <>
    <span {...reveal.handlers} className={`deck-name ${className}`} title={display}>{display}</span>
    {reveal.open && createPortal(<dialog ref={dialog} className="deck-name-dialog" aria-label="Full deck name" onCancel={reveal.close} onPointerDown={event => { backdropPressed.current = event.target === event.currentTarget; }} onClick={event => { event.stopPropagation(); if(event.target === event.currentTarget && backdropPressed.current) reveal.close(); }} onClose={reveal.close}>
      <div><p>{display}</p><button type="button" autoFocus onClick={event => { event.stopPropagation(); reveal.close(); }}>Close</button></div>
    </dialog>, document.body)}
  </>;
}
