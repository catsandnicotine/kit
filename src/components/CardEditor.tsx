import { CardFaceIndicator } from './CardFaceIndicator';
import { InlineConfirmation } from './InlineConfirmation';
import type { CardEditorProps } from '../types/editorUi';
import { KitHeader } from './KitHeader';
import { UiIcon } from './UiIcon';
/**
 * A full-page card editor with one active face and a shared bottom Save action.
 * Text and photo drafts stay mounted across face changes. Secondary card details
 * stay collapsed; Back and deletion use inline, explicit decisions.
 */

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useCardEditor } from '../hooks/useCardEditor';
import { TagLabel } from './TagLabel';
import { useCardEditorMedia } from '../hooks/useCardEditorMedia';
import { useCardSeenReset } from '../hooks/useCardSeenReset';
import { hasMeaningfulCardContent } from '../lib/cardContent';
import { getMediaReferences } from '../lib/media';
import { CardSideEditor } from './CardSideEditor';
import type { CardSideEditorHandle } from '../types/cardBlocks';
import './CardSeenReset.css';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Helpers — extract media references from HTML
// ---------------------------------------------------------------------------

interface MediaRef {
  filename: string;
  type: 'image' | 'sound';
}

/** Extract all media references from card HTML. */
function extractMediaRefs(html: string): MediaRef[] {
  const refs: MediaRef[] = [];
  const seen = new Set<string>();

  // Images: src="...", href="...", xlink:href="..."
  const imgRegex = /\b(?:src|(?:xlink:)?href)=["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = imgRegex.exec(html)) !== null) {
    const src = m[1];
    if (!src) continue;
    if (src.startsWith('data:') || src.startsWith('http') || src.startsWith('blob:') || src.startsWith('#')) continue;
    if (!seen.has(src)) {
      seen.add(src);
      refs.push({ filename: src, type: 'image' });
    }
  }

  // Sounds: [sound:filename]
  const sndRegex = /\[sound:([^\]]+)\]/g;
  while ((m = sndRegex.exec(html)) !== null) {
    if (m[1] && !seen.has(m[1])) {
      seen.add(m[1]);
      refs.push({ filename: m[1], type: 'sound' });
    }
  }

  return refs;
}

/** Strip [sound:...] tags from HTML (shown in dedicated audio section). */
function stripSounds(html: string): string {
  return html.replace(/\[sound:[^\]]+\]/g, '');
}

// ---------------------------------------------------------------------------
// MediaInventory — read-only list of referenced media files
// ---------------------------------------------------------------------------

function MediaInventory({
  refs,
  side,
  rewriteHtml,
}: {
  refs: MediaRef[];
  side: string;
  rewriteHtml: ((html: string) => string) | undefined;
}) {
  const sounds = refs.filter(r => r.type === 'sound');

  if (sounds.length === 0) return null;

  return (
    <details className="editor-attachments"><summary aria-label={`${side} audio`}>Audio <span>{sounds.length}</span></summary><div className="space-y-2 pt-3">
      {/* Audio */}
      {sounds.length > 0 && (
        <div>
          <label className="block text-xs font-medium text-text-muted mb-1">
            {side} Audio ({sounds.length})
          </label>
          <div className="space-y-1.5">
            {sounds.map((snd, i) => {
              let audioSrc: string | null = null;
              if (rewriteHtml) {
                const resolved = rewriteHtml(`[sound:${snd.filename}]`);
                const match = /src="([^"]+)"/.exec(resolved);
                if (match?.[1]) audioSrc = match[1];
              }
              return (
                <div
                  key={`${snd.filename}-${i}`}
                  className="p-2 bg-surface-light dark:bg-surface-dark rounded-lg"
                >
                  <p className="text-xs text-text-light dark:text-text-dark truncate">
                    {snd.filename}
                  </p>
                  {audioSrc && (
                    <audio src={audioSrc} controls preload="auto" className="w-full mt-1 h-8" />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div></details>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CardEditor({ db, card, rewriteHtml, onSave, onDelete, onDismiss: closeEditor, isNew, initialFace = 'front', deckTags = [], onMediaAdded, onSyncEdit }: CardEditorProps) {
  const editor = useCardEditor(db, card, isNew, onSyncEdit, initialFace);
  const seenReset = useCardSeenReset({ deckId:card.deckId, cardId:card.id, enabled:!isNew });
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [error, setError] = useState('');
  const [newCardValid, setNewCardValid] = useState(
    () => hasMeaningfulCardContent(card.front) && hasMeaningfulCardContent(card.back),
  );

  const frontRef = useRef<CardSideEditorHandle>(null);
  const backRef = useRef<CardSideEditorHandle>(null);
  const frontDraftRef = useRef(card.front);
  const backDraftRef = useRef(card.back);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const imageTargetRef = useRef<'front' | 'back'>('back');

  const handleSideChange = useCallback((side: 'front' | 'back', html: string) => {
    if (side === 'front') frontDraftRef.current = html;
    else backDraftRef.current = html;
    editor.markContentDirty();
    if (isNew) setNewCardValid(
      hasMeaningfulCardContent(frontDraftRef.current) && hasMeaningfulCardContent(backDraftRef.current),
    );
  }, [editor, isNew]);

  // ── Media references ────────────────────────────────────────────────────

  const frontRefs = useMemo(() => extractMediaRefs(card.front), [card.front]);
  const backRefs = useMemo(() => extractMediaRefs(card.back), [card.back]);

  // Build a reverse map: blob URL → original filename, so we can undo
  // the rewriting when saving the HTML back to the database.
  const reverseMap = useMemo(() => {
    const map = new Map<string, string>();
    if (!rewriteHtml) return map;
    // Include CSS backgrounds, video posters and subtitle files as well as images.
    const allRefs = getMediaReferences(card.front + card.back);
    for (const filename of allRefs) {
        const escaped = filename.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
        const resolved = rewriteHtml(`<img src="${escaped}">`);
        const match = /src="([^"]+)"/.exec(resolved);
        if (match?.[1] && match[1] !== escaped) {
          map.set(match[1], filename);
        }
    }
    return map;
  }, [rewriteHtml, card.front, card.back]);

  // Prepare display HTML: rewrite media refs for display, strip [sound:] tags
  // (sounds are shown in the inventory instead).
  const displayFrontHtml = useMemo(() => {
    const html = stripSounds(card.front);
    return rewriteHtml ? rewriteHtml(html) : html;
  }, [card.front, rewriteHtml]);

  const displayBackHtml = useMemo(() => {
    const html = stripSounds(card.back);
    return rewriteHtml ? rewriteHtml(html) : html;
  }, [card.back, rewriteHtml]);

  const panelRef = useRef<HTMLDialogElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { panelRef.current?.showModal(); }, []);
  useLayoutEffect(() => {
    scrollRef.current?.scrollTo({ top:0 });
    if (isNew) (editor.face === 'front' ? frontRef : backRef).current?.focus();
  }, [editor.face, isNew]);

  const media = useCardEditorMedia({ deckId:card.deckId, frontRef, backRef, reverseMap, onMediaAdded, onError:setError });
  const editorBusy = media.busy || seenReset.busy;
  const onDismiss = () => {
    if (media.busyRef.current || seenReset.isBusy()) return;
    seenReset.cancelReset();
    if (editor.dirty) { setShowDeleteConfirm(false); setShowDiscardConfirm(true); }
    else closeEditor();
  };
  const handleImageFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])];
    event.target.value = '';
    if (seenReset.isBusy()) return;
    void media.addFiles(imageTargetRef.current, files);
  };

  const handleAddImage = (side: 'front' | 'back') => {
      if (media.busyRef.current || seenReset.isBusy()) return;
      imageTargetRef.current = side;
      imageInputRef.current?.click();
  };

  // ── Handlers ────────────────────────────────────────────────────────────
  const handleSave = useCallback(() => {
    if (media.busyRef.current || seenReset.isBusy()) return;
    let front = frontRef.current?.getHtml() ?? card.front;
    let back = backRef.current?.getHtml() ?? card.back;

    front = media.restoreReferences(front);
    back = media.restoreReferences(back);

    // Re-inject [sound:] tags that were stripped for display
    const frontSounds = frontRefs.filter(r => r.type === 'sound');
    const backSounds = backRefs.filter(r => r.type === 'sound');
    if (frontSounds.length > 0) {
      front += frontSounds.map(s => `[sound:${s.filename}]`).join('');
    }
    if (backSounds.length > 0) {
      back += backSounds.map(s => `[sound:${s.filename}]`).join('');
    }

    const result = editor.save(front, back);
    if (result.success) {
      onSave(result.data);
    } else {
      setError(result.error);
    }
  }, [editor, card.front, card.back, media, seenReset, frontRefs, backRefs, onSave]);

  const handleDelete = () => {
    if (media.busyRef.current || seenReset.isBusy()) return;
    const result = editor.remove();
    if (result.success) {
      onDelete();
    } else {
      setError(result.error);
      setShowDeleteConfirm(false);
    }
  };


  return <dialog ref={panelRef} className="card-editor-panel card-editor-page focused-card-editor" aria-label={isNew ? 'New card' : 'Edit card'} aria-busy={editorBusy}
    onCancel={event => { event.preventDefault(); if (media.busyRef.current || seenReset.isBusy()) return; if (seenReset.confirming) seenReset.cancelReset(); else if (showDeleteConfirm) setShowDeleteConfirm(false); else if (showDiscardConfirm) setShowDiscardConfirm(false); else onDismiss(); }}>
    <input ref={imageInputRef} type="file" accept="image/*,video/*" multiple onChange={handleImageFileChange} className="hidden" />
    <KitHeader quiet leading={<button type="button" onClick={onDismiss} disabled={editorBusy} aria-label="Back" className="kit-icon-button"><UiIcon name="back" /></button>} />
    <div ref={scrollRef} className="card-editor-scroll focused-editor-scroll">
      <h1 className="focused-editor-title">{isNew ? 'New card' : 'Edit card'}</h1>
      {media.busy && <p className="editor-status" role="status">Working with media…</p>}
      <div className="editor-working-area" inert={seenReset.busy || undefined}>
        <div hidden={editor.face !== 'front'}>
          <CardSideEditor key={`${card.id}-front`} ref={frontRef} label="Front" initialHtml={displayFrontHtml}
            onChange={html => handleSideChange('front', html)} onAddImage={() => handleAddImage('front')}
            onAddFiles={files => { if (!seenReset.isBusy()) void media.addFiles('front', files); }} onPasteMedia={() => { if (!seenReset.isBusy()) void media.paste('front'); }}
            onCopyMedia={(url, kind) => { if (!seenReset.isBusy()) void media.copy(url, kind); }} busy={editorBusy} visible={editor.face === 'front'} />
        </div>
        <div hidden={editor.face !== 'back'}>
          <CardSideEditor key={`${card.id}-back`} ref={backRef} label="Back" initialHtml={displayBackHtml}
            onChange={html => handleSideChange('back', html)} onAddImage={() => handleAddImage('back')}
            onAddFiles={files => { if (!seenReset.isBusy()) void media.addFiles('back', files); }} onPasteMedia={() => { if (!seenReset.isBusy()) void media.paste('back'); }}
            onCopyMedia={(url, kind) => { if (!seenReset.isBusy()) void media.copy(url, kind); }} busy={editorBusy} visible={editor.face === 'back'} />
        </div>
      </div>
      <details className="editor-card-details"><summary>Card details</summary>
        {!isNew && <div className="editor-seen-count">
          <div className="editor-seen-count-label"><span>Seen count</span><span className="editor-seen-count-value" aria-label={seenReset.count === null ? undefined : `Seen count: ${seenReset.count.toLocaleString()}`}>{seenReset.count === null ? (seenReset.loading ? 'Loading…' : 'Unavailable') : `×${seenReset.count.toLocaleString()}`}</span></div>
          <button type="button" disabled={editorBusy || seenReset.count === null || seenReset.count === 0} aria-label="Reset seen count" onClick={() => {
            if (media.busyRef.current || seenReset.isBusy()) return;
            setError(''); setShowDeleteConfirm(false); setShowDiscardConfirm(false); seenReset.requestReset();
          }}>Reset</button>
        </div>}
        {seenReset.status && <p className="editor-status" role="status">{seenReset.status}</p>}
        <MediaInventory refs={frontRefs} side="Front" rewriteHtml={rewriteHtml} />
        <MediaInventory refs={backRefs} side="Back" rewriteHtml={rewriteHtml} />
        {deckTags.length > 0 && <div className="editor-tag-choices" role="group" aria-label="Card tags">
          {deckTags.map(tc => {
            const isOn = editor.tags.includes(tc.tag);
            return <button key={tc.tag} type="button" className="tag-control" disabled={editorBusy} aria-pressed={isOn} onClick={() => {
              if (seenReset.isBusy()) return;
              if (isOn) editor.removeTag(editor.tags.indexOf(tc.tag)); else editor.addTag(tc.tag);
            }} style={{ opacity:isOn ? 1 : .4 }}><TagLabel name={tc.tag} color={tc.color} /></button>;
          })}
        </div>}
        {!isNew && <button type="button" disabled={editorBusy} className="editor-delete-action" onClick={() => { if (media.busyRef.current || seenReset.isBusy()) return; seenReset.cancelReset(); setShowDiscardConfirm(false); setShowDeleteConfirm(true); }}><UiIcon name="trash" />Delete card</button>}
        {isNew && deckTags.length === 0 && frontRefs.every(ref => ref.type !== 'sound') && backRefs.every(ref => ref.type !== 'sound') && <p className="editor-status">No attachments or tags.</p>}
      </details>
    </div>
    <footer className="focused-editor-footer">
      {(error || seenReset.error) && <p className="editor-error" role="alert">{error || seenReset.error}</p>}
      {seenReset.confirming ? <InlineConfirmation busy={editorBusy} title="Reset seen count?" detail="Review schedule stays the same." confirmLabel="Reset" onCancel={seenReset.cancelReset} onConfirm={() => { if (!media.busyRef.current) void seenReset.confirmReset(); }} />
        : showDiscardConfirm ? <InlineConfirmation busy={editorBusy} title="Discard changes?" detail="Your saved card will stay as it was." cancelLabel="Keep editing" confirmLabel="Discard" onCancel={() => { if (media.busyRef.current || seenReset.isBusy()) return; setShowDiscardConfirm(false); (editor.face === 'front' ? frontRef : backRef).current?.focus(); }} onConfirm={() => { if (!media.busyRef.current && !seenReset.isBusy()) closeEditor(); }} />
        : showDeleteConfirm ? <InlineConfirmation busy={editorBusy} title="Delete this card?" detail="This also removes its study history." confirmLabel="Delete card" onCancel={() => { if (media.busyRef.current || seenReset.isBusy()) return; setShowDeleteConfirm(false); (editor.face === 'front' ? frontRef : backRef).current?.focus(); }} onConfirm={handleDelete} />
        : <div className="focused-editor-actions"><CardFaceIndicator face={editor.face} onFlip={() => editor.setFace(editor.face === 'front' ? 'back' : 'front')} disabled={editorBusy} />
          <button type="button" onClick={handleSave} disabled={editorBusy || (isNew ? !newCardValid : !editor.dirty)} className="creation-next-button editor-save-button">Save card<UiIcon name="check" /></button>
        </div>}
    </footer>
  </dialog>;
}
