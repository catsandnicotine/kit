import type { DeckNameFormProps } from '../types/deckCreation';
import { UiIcon } from './UiIcon';

/** A single name field that leads directly to making the first card.
 * @param props - Controlled draft, availability and save callback.
 * @returns A spacious name field and one clearly placed next action.
 */
export function DeckNameForm({ name, onNameChange, nameLocked, creating, disabled, error, onCreate }: DeckNameFormProps) {
  return <form className="deck-name-form" onSubmit={event => {
    event.preventDefault();
    if (name.trim() && !creating && !disabled) onCreate(name.trim());
  }}>
    <label htmlFor="new-deck-name" className="sr-only">Deck name</label>
    <input id="new-deck-name" autoFocus value={name} onChange={event => onNameChange(event.target.value)} placeholder="e.g. Biology" maxLength={80} disabled={creating || nameLocked} autoComplete="off" enterKeyHint="next" />
    {error && <p className="deck-entry-error" role="alert">{error}</p>}
    <footer className="creation-page-footer"><button type="submit" className="creation-next-button" disabled={creating || disabled || !name.trim()}>
      {creating ? 'Creating…' : 'Add first card'}<UiIcon name="arrow" />
    </button></footer>
  </form>;
}
