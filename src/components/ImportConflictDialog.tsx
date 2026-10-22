import { useEffect, useRef } from 'react';
import type { ImportConflictDialogProps } from '../types/deckCreation';
import { DeckName } from './DeckName';

/** Let a duplicate import continue safely without hiding replacement consequences.
 * @param props - Conflicting deck and explicit resolution callbacks.
 * @returns A focused native dialog that prioritizes keeping existing work.
 */
export function ImportConflictDialog({ deckName, canReplace, onKeepBoth, onReplace, onCancel }: ImportConflictDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="deck-entry-dialog import-conflict-dialog" aria-labelledby="import-conflict-title" onCancel={event => { event.preventDefault(); onCancel(); }}>
    <h2 id="import-conflict-title">Already in your library</h2>
    <DeckName name={deckName} className="import-conflict-name" />
    <button type="button" autoFocus className="deck-entry-primary" onClick={onKeepBoth}>{canReplace ? 'Keep both decks' : 'Import copies'}</button>
    {canReplace && <button type="button" className="import-conflict-replace" onClick={onReplace}>Replace existing deck<small>Replaces its cards and study history.</small></button>}
    <button type="button" className="deck-entry-back" onClick={onCancel}>Cancel</button>
  </dialog>;
}
