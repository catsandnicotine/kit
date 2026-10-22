import { useEffect, useState } from 'react';
import type { ManageDeckActionsProps } from '../types/manageDeck';
import { useManageDeck } from '../hooks/useManageDeck';
import { InlineConfirmation } from './InlineConfirmation';
import { ThumbnailCropper } from './ThumbnailCropper';
import { LibraryNotice } from './LibraryNotice';

/** A single home for deck details, backup, scheduling and deletion.
 * @param props - Current deck and navigation callbacks.
 * @returns In-flow deck actions with explicit saves and inline deletion confirmation.
 */
export function ManageDeckActions(props: ManageDeckActionsProps) {
  const actions = useManageDeck(props);
  const onBusyChange = props.onBusyChange;
  useEffect(() => { onBusyChange?.(actions.busy); return () => onBusyChange?.(false); }, [actions.busy, onBusyChange]);
  const name = props.nameDraft;
  const nameDirty = name.trim() !== props.deckName;
  const [deleting, setDeleting] = useState(false);
  return <section className="manage-deck-actions" aria-label="Deck details">
    {actions.notice && <LibraryNotice notice={actions.notice} {...(actions.notice.tone !== 'progress' ? { onDismiss:actions.dismissNotice } : {})} />}
    {actions.error && <p role="alert" className="editor-error">{actions.error}</p>}
    <form className="manage-deck-name" onSubmit={event => { event.preventDefault(); void actions.rename(name); }}>
      <label htmlFor="manage-deck-name">Deck name</label>
      <div><input id="manage-deck-name" value={name} onChange={event => props.onNameDraftChange(event.target.value)} disabled={actions.busy} />
        <button type="submit" disabled={actions.busy || !name.trim() || name.trim() === props.deckName}>Save</button></div>
    </form>
    <div className="manage-deck-action-list">
      <button type="button" onClick={props.onSettings} disabled={actions.busy || nameDirty}>Scheduling<span aria-hidden="true">›</span></button>
      <button type="button" onClick={props.onStats} disabled={actions.busy || nameDirty}>Activity<span aria-hidden="true">›</span></button>
      <button type="button" onClick={() => void actions.pickCover()} disabled={actions.busy}>Cover<span aria-hidden="true">+</span></button>
      <button type="button" onClick={() => void actions.restore()} disabled={actions.busy}>Restore pictures & audio<span aria-hidden="true">↗</span></button>
    </div>
    <details className="manage-deck-share"><summary>Export</summary><div className="manage-deck-action-list">
      <button type="button" onClick={() => void actions.exportFresh()} disabled={actions.busy}>Cards only<span aria-hidden="true">↗</span></button>
      <button type="button" onClick={() => void actions.exportProgress()} disabled={actions.busy}>Cards & study history<span aria-hidden="true">↗</span></button>
    </div></details>
    {deleting ? <InlineConfirmation title="Delete this deck?" detail="Removes its cards, study history and media, including synced copies. Your original Anki file stays unchanged." confirmLabel="Delete deck" busy={actions.busy} onCancel={() => setDeleting(false)} onConfirm={() => void actions.remove()} />
      : <button type="button" className="editor-delete-action" disabled={actions.busy} onClick={() => setDeleting(true)}>Delete deck</button>}
    {actions.cropFile && <ThumbnailCropper file={actions.cropFile} onSave={base64 => { void actions.saveCover(base64); }} onCancel={actions.cancelCrop} />}
  </section>;
}
