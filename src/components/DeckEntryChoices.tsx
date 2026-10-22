import type { DeckEntryChoicesProps } from '../types/deckCreation';
import { UiIcon } from './UiIcon';
import { DeckCreationArt } from './DeckCreationArt';

/** The same two deck-entry routes at first launch and in the library.
 * @param props - Availability and creation/import callbacks.
 * @returns Quiet visual choices with short labels for the two distinct actions.
 */
export function DeckEntryChoices({ disabled, importing, onCreate, onImport }: DeckEntryChoicesProps) {
  return <div className="deck-entry-choices">
    <button type="button" className="deck-entry-choice deck-entry-choice--make" onClick={onCreate} disabled={disabled}>
      <DeckCreationArt kind="make" /><span><strong>Make cards</strong><small>Text · photos</small></span><UiIcon name="arrow" />
    </button>
    <button type="button" className="deck-entry-choice deck-entry-choice--import" onClick={onImport} disabled={disabled}>
      <DeckCreationArt kind="import" /><span><strong>{importing ? 'Opening Files…' : 'Import Anki'}</strong><small>.apkg</small></span><UiIcon name="arrow" />
    </button>
  </div>;
}
