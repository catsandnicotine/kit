/**
 * CardEditor — slide-up overlay for editing a card during study.
 *
 * Features:
 *  - Contenteditable rich fields for front/back with B/I/U toolbar.
 *  - Tag chips with tap-to-remove and input-to-add.
 *  - "Add Image" button: Capacitor photo picker on native, file input in browser.
 *  - "Delete Card" with a confirmation dialog.
 *  - Swipe-down gesture or Cancel button to dismiss.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Database } from 'sql.js';
import type { Card } from '../types';
import { useCardEditor } from '../hooks/useCardEditor';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CardEditorProps {
  db: Database | null;
  card: Card;
  /** Called after a successful save with the updated card. */
  onSave: (updated: Card) => void;
  /** Called after a successful delete. */
  onDelete: () => void;
  /** Called when the editor is dismissed without saving. */
  onDismiss: () => void;
}

// ---------------------------------------------------------------------------
// RichField — contenteditable div with B/I/U toolbar
// ---------------------------------------------------------------------------

interface RichFieldProps {
  label: string;
  initialHtml: string;
  contentRef: React.RefObject<HTMLDivElement | null>;
  onInput: () => void;
}

function RichField({ label, initialHtml, contentRef, onInput }: RichFieldProps) {
  // Set initial HTML once on mount.
  useEffect(() => {
    if (contentRef.current && contentRef.current.innerHTML !== initialHtml) {
      contentRef.current.innerHTML = initialHtml;
    }
    // Only on mount / when initialHtml identity changes (new card).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialHtml]);

  const execCommand = useCallback((cmd: string) => {
    // Focus the contenteditable first so execCommand targets it.
    contentRef.current?.focus();
    document.execCommand(cmd, false);
  }, [contentRef]);

  return (
    <div>
      <label className="block text-xs font-medium text-text-muted mb-1">
        {label}
      </label>
      {/* Toolbar */}
      <div className="flex gap-1 mb-1">
        <button
          type="button"
          onMouseDown={e => e.preventDefault()}
          onClick={() => execCommand('bold')}
          className="px-2 py-0.5 text-xs font-bold border border-border-light dark:border-border-dark rounded text-text-light dark:text-text-dark hover:bg-surface-light dark:hover:bg-surface-dark"
        >
          B
        </button>
        <button
          type="button"
          onMouseDown={e => e.preventDefault()}
          onClick={() => execCommand('italic')}
          className="px-2 py-0.5 text-xs italic border border-border-light dark:border-border-dark rounded text-text-light dark:text-text-dark hover:bg-surface-light dark:hover:bg-surface-dark"
        >
          I
        </button>
        <button
          type="button"
          onMouseDown={e => e.preventDefault()}
          onClick={() => execCommand('underline')}
          className="px-2 py-0.5 text-xs underline border border-border-light dark:border-border-dark rounded text-text-light dark:text-text-dark hover:bg-surface-light dark:hover:bg-surface-dark"
        >
          U
        </button>
      </div>
      {/* Editable area */}
      <div
        ref={contentRef}
        contentEditable
        onInput={onInput}
        className="rich-field w-full min-h-[6rem] px-3 py-2 text-sm bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark rounded-lg text-text-light dark:text-text-dark overflow-y-auto focus:outline-none focus:ring-1 focus:ring-accent-light dark:focus:ring-accent-dark card-content"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CardEditor({ db, card, onSave, onDelete, onDismiss }: CardEditorProps) {
  const editor = useCardEditor(db, card);
  const [tagInput, setTagInput] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [error, setError] = useState('');

  const frontRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  /** Track which field ('front' | 'back') should receive the inserted image. */
  const imageTargetRef = useRef<'front' | 'back'>('back');

  // ── Swipe-down dismiss ──────────────────────────────────────────────────
  const startYRef = useRef<number | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    if (touch.clientY - rect.top > 48) return;
    startYRef.current = touch.clientY;
  }, []);

  const onTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (startYRef.current === null) return;
      const dy = e.changedTouches[0].clientY - startYRef.current;
      startYRef.current = null;
      if (dy > 100) onDismiss();
    },
    [onDismiss],
  );

  // ── Image insertion ─────────────────────────────────────────────────────

  /** Insert an <img> tag into the currently-focused contenteditable field. */
  const insertImageDataUrl = useCallback(
    (dataUrl: string) => {
      const target = imageTargetRef.current === 'front' ? frontRef.current : backRef.current;
      if (!target) return;
      target.focus();
      // Insert at end
      const img = document.createElement('img');
      img.src = dataUrl;
      img.style.maxWidth = '100%';
      target.appendChild(img);
      editor.markContentDirty();
    },
    [editor],
  );

  const handleImageFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      e.target.value = '';

      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          insertImageDataUrl(reader.result);
        }
      };
      reader.readAsDataURL(file);
    },
    [insertImageDataUrl],
  );

  const handleAddImage = useCallback(
    (target: 'front' | 'back') => {
      imageTargetRef.current = target;
      // Uses a standard file input. On native Capacitor builds, this opens the
      // system photo picker. A dedicated @capacitor/camera integration can be
      // added later when the plugin is installed.
      imageInputRef.current?.click();
    },
    [],
  );

  // ── Handlers ────────────────────────────────────────────────────────────
  const handleSave = useCallback(() => {
    const front = frontRef.current?.innerHTML ?? card.front;
    const back = backRef.current?.innerHTML ?? card.back;
    const result = editor.save(front, back);
    if (result.success) {
      onSave(result.data);
    } else {
      setError(result.error);
    }
  }, [editor, card.front, card.back, onSave]);

  const handleDelete = useCallback(() => {
    const result = editor.remove();
    if (result.success) {
      onDelete();
    } else {
      setError(result.error);
    }
  }, [editor, onDelete]);

  const handleAddTag = useCallback(() => {
    if (tagInput.trim()) {
      editor.addTag(tagInput);
      setTagInput('');
    }
  }, [editor, tagInput]);

  const handleTagKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleAddTag();
      }
    },
    [handleAddTag],
  );

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-40"
        onClick={onDismiss}
      />

      {/* Hidden file input for image picker fallback */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        onChange={handleImageFileChange}
        className="hidden"
      />

      {/* Panel */}
      <div
        ref={panelRef}
        className="card-editor-panel fixed inset-x-0 bottom-0 z-50 bg-background-light dark:bg-background-dark rounded-t-2xl shadow-2xl max-h-[85vh] flex flex-col"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-2 cursor-grab shrink-0">
          <div className="w-10 h-1 bg-border-light dark:bg-border-dark rounded-full" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-4 pb-3 border-b border-border-light dark:border-border-dark shrink-0">
          <button
            onClick={onDismiss}
            className="text-sm text-text-muted"
          >
            Cancel
          </button>
          <span className="text-sm font-semibold text-text-light dark:text-text-dark">
            Edit Card
          </span>
          <button
            onClick={handleSave}
            disabled={!editor.dirty}
            className={`text-sm font-semibold ${
              editor.dirty
                ? 'text-accent-light dark:text-accent-dark'
                : 'text-text-muted opacity-50'
            }`}
          >
            Save
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
          {/* Error */}
          {error && (
            <p className="text-xs text-red-500">{error}</p>
          )}

          {/* Front */}
          <RichField
            label="Front"
            initialHtml={card.front}
            contentRef={frontRef}
            onInput={editor.markContentDirty}
          />
          <button
            type="button"
            onClick={() => handleAddImage('front')}
            className="w-full py-1.5 text-xs text-text-muted border border-dashed border-border-light dark:border-border-dark rounded-lg"
          >
            Add Image to Front…
          </button>

          {/* Back */}
          <RichField
            label="Back"
            initialHtml={card.back}
            contentRef={backRef}
            onInput={editor.markContentDirty}
          />
          <button
            type="button"
            onClick={() => handleAddImage('back')}
            className="w-full py-1.5 text-xs text-text-muted border border-dashed border-border-light dark:border-border-dark rounded-lg"
          >
            Add Image to Back…
          </button>

          {/* Tags */}
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">
              Tags
            </label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {editor.tags.map((tag, i) => (
                <button
                  key={`${tag}-${i}`}
                  onClick={() => editor.removeTag(i)}
                  className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark rounded-full text-text-light dark:text-text-dark"
                >
                  {tag}
                  <span className="text-text-muted">&times;</span>
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={handleTagKeyDown}
                placeholder="Add tag…"
                className="flex-1 px-3 py-1.5 text-sm bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark rounded-lg text-text-light dark:text-text-dark"
              />
              <button
                onClick={handleAddTag}
                disabled={!tagInput.trim()}
                className="px-3 py-1.5 text-sm font-medium text-accent-light dark:text-accent-dark disabled:opacity-40"
              >
                Add
              </button>
            </div>
          </div>

          {/* Delete Card */}
          {!showDeleteConfirm ? (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="w-full py-2.5 text-sm text-red-500 border border-red-500/30 rounded-lg"
            >
              Delete Card
            </button>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 py-2.5 text-sm text-text-muted border border-border-light dark:border-border-dark rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                className="flex-1 py-2.5 text-sm text-white bg-red-500 rounded-lg font-semibold"
              >
                Confirm Delete
              </button>
            </div>
          )}
        </div>

        {/* Bottom safe area spacer */}
        <div className="pb-safe-bottom shrink-0" />
      </div>
    </>
  );
}
