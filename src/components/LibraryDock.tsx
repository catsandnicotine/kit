import type { LibraryDockProps } from '../types/libraryTools';
import { UiIcon } from './UiIcon';
import './LibraryDock.css';

/** Put the library's everyday utilities within easy reach, without a menu.
 * @param props - Existing search, settings and creation actions and readiness.
 * @returns Three quiet circular controls with full accessible action names.
 */
export function LibraryDock({ onSearch, onSettings, onAdd, searchOpen, searchFiltered, addDisabled, native, keyboardRaised }: LibraryDockProps) {
  if (native) return <div className={`library-dock library-dock--native${keyboardRaised ? ' library-dock--keyboard' : ''}`} aria-hidden="true" />;
  return <nav className="library-dock" aria-label="Library actions">
    <button type="button" className={`utility-bubble${searchFiltered && !searchOpen ? ' utility-bubble--filtered' : ''}`} aria-label={searchOpen ? 'Clear and close search' : searchFiltered ? 'Search decks, filter active' : 'Search decks'} aria-expanded={searchOpen} aria-controls={searchOpen ? 'library-search' : undefined} onClick={onSearch}><UiIcon name={searchOpen ? 'close' : 'search'} /></button>
    <button type="button" className="utility-bubble" aria-label="Settings" onClick={onSettings}><UiIcon name="settings" /></button>
    <button type="button" className="utility-bubble" aria-label="Add deck" disabled={addDisabled} onClick={onAdd}><UiIcon name="plus" /></button>
  </nav>;
}
