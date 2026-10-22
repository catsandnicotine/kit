import { useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { useCardSideEditor } from '../hooks/useCardSideEditor';
import { editorMediaPreview, getCardBlockDropAnchor, getCardBlockMediaSource } from '../lib/cardBlocks';
import { getPastedCardFiles, hasEphemeralPastedMedia } from '../lib/cardClipboard';
import { usePauseHiddenMedia } from '../hooks/usePauseHiddenMedia';
import type { CardSideEditorProps } from '../types/cardBlocks';
import { InlineConfirmation } from './InlineConfirmation';
import { UiIcon } from './UiIcon';
import './CardSideEditor.css';
import './LegacyCardHints.css';

/** Edit one card side as movable text and photo sections.
 * @param props - Side label, initial rich content and media/save callbacks.
 * @returns An unframed side editor with touch and keyboard ordering controls.
 */
export function CardSideEditor({ label, initialHtml, onChange, onAddImage, onAddFiles, onPasteMedia, onCopyMedia, busy = false, visible = true, autoFocus = false, ref }: CardSideEditorProps) {
  const editor = useCardSideEditor(initialHtml, onChange);
  const removeTrigger = useRef<HTMLButtonElement | null>(null);
  const arrangeTrigger = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: string; destination: number } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropPosition, setDropPosition] = useState<number | null>(null);
  const dropAnchor = dragging && dropPosition !== null
    ? getCardBlockDropAnchor(editor.blocks, dragging, dropPosition) : null;
  useLayoutEffect(() => {
    if (!editor.arranging) { dragRef.current = null; setDragging(null); setDropPosition(null); }
  }, [editor.arranging]);
  const focusField = editor.focus;
  useImperativeHandle(ref, () => ({ getHtml: editor.getHtml, insertImage: editor.insertImage, insertMedia:editor.insertMedia, focus: editor.focus }), [editor.getHtml, editor.insertImage, editor.insertMedia, editor.focus]);
  usePauseHiddenMedia(listRef, visible && !editor.arranging && !busy);
  useLayoutEffect(() => { if (autoFocus) focusField(); }, [autoFocus, focusField]);

  const format = (command: string) => {
    const field = editor.textRefs.current.get(editor.activeRef.current);
    field?.focus();
    document.execCommand(command, false);
    editor.changeText(editor.activeRef.current);
  };
  const startDrag = (event: React.PointerEvent<HTMLButtonElement>, id: string, index: number) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { id, destination: index };
    setDragging(id); setDropPosition(index); editor.beginDrag();
  };
  const updateDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragRef.current || !listRef.current) return;
    const nodes = [...listRef.current.querySelectorAll<HTMLElement>('[data-card-block]')];
    const others = nodes.filter(node => node.dataset.cardBlock !== dragRef.current?.id);
    const destination = others.filter(node => event.clientY > node.getBoundingClientRect().top + node.getBoundingClientRect().height / 2).length;
    dragRef.current.destination = destination; setDropPosition(destination);
    const scroller = listRef.current.closest('.card-creation-body, .card-editor-scroll');
    if (scroller) {
      const bounds = scroller.getBoundingClientRect();
      if (event.clientY > bounds.bottom - 52) scroller.scrollBy({ top: 12 });
      else if (event.clientY < bounds.top + 52) scroller.scrollBy({ top: -12 });
    }
  };
  const finishDrag = (cancelled = false) => {
    if (dragRef.current && !cancelled) editor.move(dragRef.current.id, dragRef.current.destination);
    dragRef.current = null; setDragging(null); setDropPosition(null);
  };

  return <section className="card-side-editor" aria-label={`${label} content`} aria-busy={busy} onPaste={event => {
    if (busy) { event.preventDefault(); return; }
    const files = getPastedCardFiles(event.clipboardData);
    if (files.length && onAddFiles) { event.preventDefault(); onAddFiles(files); }
    else if (hasEphemeralPastedMedia(event.clipboardData) && onPasteMedia) { event.preventDefault(); onPasteMedia(); }
  }}>
    {editor.metadata && <div hidden aria-hidden="true" dangerouslySetInnerHTML={{ __html: editor.metadata }} />}
    <div className="editor-field-heading">
      <label>{label}</label>
    </div>
    {editor.arranging && <p className="side-arrange-hint">Drag sections, or use the arrows.</p>}
    <div ref={listRef} inert={busy || undefined} className={`side-block-list ${editor.arranging ? 'is-arranging' : ''}`}>
      {editor.blocks.map((block, index) => <div key={block.id} data-card-block={block.id} className={`side-block ${block.kind !== 'text' ? 'side-block--photo' : ''} ${dragging === block.id ? 'is-dragging' : ''} ${dragging && dropAnchor === block.id ? 'is-drop-target' : ''}`}>
        {editor.arranging ? <>
          <button type="button" disabled={busy} className="side-drag-handle" aria-label={`Drag ${label.toLowerCase()} ${block.kind === 'image' ? 'photo' : block.kind === 'video' ? 'video' : 'text'} ${index + 1}`} onPointerDown={event => startDrag(event, block.id, index)} onPointerMove={updateDrag} onPointerUp={() => finishDrag()} onPointerCancel={() => finishDrag(true)} onLostPointerCapture={() => { if (dragRef.current) finishDrag(true); }}><UiIcon name="grip" /></button>
          <div className="side-block-preview card-content" dangerouslySetInnerHTML={{ __html: editorMediaPreview(block.html) || '<span class="side-empty-text">Empty text</span>' }} />
          <div className="side-order-controls">
            {block.kind !== 'text' && onCopyMedia && <button type="button" className="kit-icon-button" disabled={busy} aria-label={`Copy ${label.toLowerCase()} ${block.kind === 'image' ? 'photo' : 'video'} ${index + 1}`} onClick={() => onCopyMedia(getCardBlockMediaSource(block.html), block.kind === 'image' ? 'image' : 'video')}><UiIcon name="copy" /></button>}
            <button type="button" className="kit-icon-button" disabled={index === 0} onClick={() => editor.move(block.id, index - 1)} aria-label={`Move ${label.toLowerCase()} section ${index + 1} up`}><UiIcon name="up" /></button>
            <button type="button" className="kit-icon-button" disabled={index === editor.blocks.length - 1} onClick={() => editor.move(block.id, index + 1)} aria-label={`Move ${label.toLowerCase()} section ${index + 1} down`}><UiIcon name="down" /></button>
            <button type="button" className="kit-icon-button" onClick={event => { removeTrigger.current = event.currentTarget; editor.requestRemove(block.id); }} aria-label={`Remove ${label.toLowerCase()} section ${index + 1}`}><UiIcon name="trash" /></button>
          </div>
          {editor.pendingRemoval === block.id && <div className="side-remove-confirm">
            <InlineConfirmation title={`Remove ${block.kind === 'image' ? 'photo' : block.kind === 'video' ? 'video' : 'text'}?`} confirmLabel="Remove" onCancel={() => { editor.cancelRemove(); removeTrigger.current?.focus(); }} onConfirm={() => { arrangeTrigger.current?.focus(); editor.confirmRemove(); }} />
          </div>}
        </> : block.kind === 'image'
          ? <button type="button" disabled={busy} className="side-photo" aria-label={`Arrange ${label.toLowerCase()} photo ${index + 1}`} onFocus={() => { editor.activeRef.current = block.id; }} onClick={() => { editor.activeRef.current = block.id; editor.toggleArrangement(); }}><span className="card-content" dangerouslySetInnerHTML={{ __html: block.html }} /></button>
          : block.kind === 'video' ? <div className="side-video" onFocus={() => { editor.activeRef.current = block.id; }}>
            <div className="card-content" dangerouslySetInnerHTML={{ __html: editorMediaPreview(block.html) }} />
            <button type="button" disabled={busy} className="side-video-options" aria-label={`Arrange ${label.toLowerCase()} video ${index + 1}`} onClick={() => { editor.activeRef.current = block.id; editor.toggleArrangement(); }}><UiIcon name="more" /></button>
          </div>
          : <div ref={element => {
            if (element) {
              editor.textRefs.current.set(block.id, element);
              if (element.innerHTML !== block.html) element.innerHTML = block.html;
            } else editor.textRefs.current.delete(block.id);
          }} contentEditable={!busy} suppressContentEditableWarning role="textbox" aria-label={index === 0 ? label : `${label} text ${index + 1}`} aria-multiline="true" data-placeholder={index === 0 ? (label === 'Front' ? 'Question or media' : 'Answer or media') : 'Add text…'} className="side-text card-content" onFocus={() => { editor.activeRef.current = block.id; }} onInput={() => editor.changeText(block.id)} />}
      </div>)}
      {dragging && dropPosition !== null && dropAnchor === null && <div className="side-block is-drop-target" aria-hidden="true" />}
    </div>
    <div className="side-editor-tools" inert={busy || undefined} role="group" aria-label={`${label} tools`}>
      {!editor.arranging && <button type="button" className="side-add-text" onClick={editor.addText}><UiIcon name="plus" /><span>Text</span></button>}
      <button type="button" disabled={busy} onClick={onAddImage} className="kit-icon-button text-text-muted" aria-label={`Add media to ${label.toLowerCase()}`} title="Add photos or videos"><UiIcon name="image" /></button>
      {onPasteMedia && <button type="button" disabled={busy} onClick={onPasteMedia} className="kit-icon-button text-text-muted" aria-label={`Paste photo or video to ${label.toLowerCase()}`} title="Paste media"><UiIcon name="paste" /></button>}
      <details className="editor-format-tools"><summary aria-label={`Format ${label.toLowerCase()} text`}>Aa</summary><div>
        {(['bold', 'italic', 'underline'] as const).map((command, index) => <button key={command} type="button" onMouseDown={event => event.preventDefault()} onClick={() => format(command)} aria-label={`${command} ${label.toLowerCase()}`} className={`side-format-command side-format-command--${command}`}>{['B', 'I', 'U'][index]}</button>)}
      </div></details>
      <button type="button" ref={arrangeTrigger} className="kit-icon-button text-text-muted" onClick={editor.toggleArrangement} aria-pressed={editor.arranging} aria-label={`${editor.arranging ? 'Finish arranging' : 'Arrange'} ${label.toLowerCase()}`} title={editor.arranging ? 'Done arranging' : 'Reorder text and photos'}><UiIcon name={editor.arranging ? 'check' : 'arrange'} /></button>
    </div>
    <p className="sr-only" role="status" aria-live="polite">{editor.announcement}</p>
  </section>;
}
