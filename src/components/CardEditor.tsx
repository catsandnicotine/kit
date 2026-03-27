/**
 * CardEditor — slide-up overlay for editing a card during study.
 *
 * Features:
 *  - Contenteditable rich fields for front/back with B/I/U toolbar.
 *  - Media inventory showing images and audio referenced by the card.
 *  - Tag chips with tap-to-remove and input-to-add.
 *  - "Delete Card" with a confirmation dialog.
 *  - Swipe-down gesture or Cancel button to dismiss.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Database } from 'sql.js';
import type { Card } from '../types';
import { useCardEditor } from '../hooks/useCardEditor';
import { pillTextColor } from '../lib/tagColors';
import { saveMediaFile, getMediaFileWebUrl } from '../lib/platform/mediaFiles';

function isNativePlatform(): boolean {
  try {
    return !!(
      typeof window !== 'undefined' &&
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).Capacitor?.isNativePlatform?.()
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CardEditorProps {
  db: Database | null;
  card: Card;
  /** Rewrite media references in HTML to blob: URLs for display. */
  rewriteHtml?: (html: string) => string;
  /** Called after a successful save with the updated card. */
  onSave: (updated: Card) => void;
  /** Called after a successful delete. */
  onDelete: () => void;
  /** Called when the editor is dismissed without saving. */
  onDismiss: () => void;
  /** If true, this is a new card being created (not editing existing). */
  isNew?: boolean;
  /** Tags available in this deck — shown as toggle pills for card tagging. */
  deckTags?: import('../lib/db/queries').TagCount[];
  /**
   * Called after a user-inserted image is saved to the filesystem so the
   * caller can update its media URL cache and display the image immediately.
   */
  onMediaAdded?: (filename: string, url: string) => void;
  /** Callback to emit sync edit operations (new per-deck architecture). */
  onSyncEdit?: (ops: import('../lib/sync/types').EditOp[]) => void;
}

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

/**
 * Reverse-map blob: URLs back to original filenames.
 * After editing in contenteditable, blob URLs need to be converted back
 * so the card HTML stores portable filenames, not ephemeral blob refs.
 */
function unrewriteHtml(
  html: string,
  reverseMap: ReadonlyMap<string, string>,
): string {
  if (reverseMap.size === 0) return html;
  let result = html;
  for (const [blobUrl, filename] of reverseMap) {
    // Replace all occurrences of this blob URL with the original filename
    result = result.split(blobUrl).join(filename);
  }
  return result;
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
  useEffect(() => {
    if (contentRef.current && contentRef.current.innerHTML !== initialHtml) {
      contentRef.current.innerHTML = initialHtml;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialHtml]);

  const execCommand = useCallback((cmd: string) => {
    contentRef.current?.focus();
    document.execCommand(cmd, false);
  }, [contentRef]);

  return (
    <div>
      <label className="block text-xs font-medium text-text-muted mb-1">
        {label}
      </label>
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
  const images = refs.filter(r => r.type === 'image');
  const sounds = refs.filter(r => r.type === 'sound');

  if (images.length === 0 && sounds.length === 0) return null;

  return (
    <div className="space-y-2">
      {/* Images */}
      {images.length > 0 && (
        <div>
          <label className="block text-xs font-medium text-text-muted mb-1">
            {side} Images ({images.length})
          </label>
          <div className="flex flex-wrap gap-2">
            {images.map((img, i) => {
              let src = img.filename;
              if (rewriteHtml) {
                const resolved = rewriteHtml(`<img src="${img.filename}">`);
                const match = /src="([^"]+)"/.exec(resolved);
                if (match?.[1]) src = match[1];
              }
              return (
                <div key={`${img.filename}-${i}`}>
                  <img
                    src={src}
                    alt={img.filename}
                    className="w-16 h-16 object-cover rounded-lg border border-border-light dark:border-border-dark"
                  />
                  <p className="text-[10px] text-text-muted truncate w-16 mt-0.5" title={img.filename}>
                    {img.filename}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

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
                  className="p-2 bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark rounded-lg"
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CardEditor({ db, card, rewriteHtml, onSave, onDelete, onDismiss, isNew, deckTags = [], onMediaAdded, onSyncEdit }: CardEditorProps) {
  const editor = useCardEditor(db, card, isNew, onSyncEdit);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [error, setError] = useState('');

  const frontRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const imageTargetRef = useRef<'front' | 'back'>('back');
  /** Maps capacitor:// URL → filename for user-inserted images (native only). */
  const userInsertedRef = useRef<Map<string, string>>(new Map());

  // ── Media references ────────────────────────────────────────────────────

  const frontRefs = useMemo(() => extractMediaRefs(card.front), [card.front]);
  const backRefs = useMemo(() => extractMediaRefs(card.back), [card.back]);

  // Build a reverse map: blob URL → original filename, so we can undo
  // the rewriting when saving the HTML back to the database.
  const reverseMap = useMemo(() => {
    const map = new Map<string, string>();
    if (!rewriteHtml) return map;
    const allRefs = [...frontRefs, ...backRefs];
    for (const ref of allRefs) {
      if (ref.type === 'image') {
        const resolved = rewriteHtml(`<img src="${ref.filename}">`);
        const match = /src="([^"]+)"/.exec(resolved);
        if (match?.[1] && match[1] !== ref.filename) {
          map.set(match[1], ref.filename);
        }
      }
      // Also handle href= for SVG <image> elements
      if (ref.type === 'image') {
        const resolved = rewriteHtml(`<image href="${ref.filename}">`);
        const match = /href="([^"]+)"/.exec(resolved);
        if (match?.[1] && match[1] !== ref.filename) {
          map.set(match[1], ref.filename);
        }
      }
    }
    return map;
  }, [rewriteHtml, frontRefs, backRefs]);

  // Prepare display HTML: rewrite media refs for display, strip [sound:] tags
  // (sounds are shown in the inventory instead).
  const displayFrontHtml = useMemo(() => {
    let html = stripSounds(card.front);
    return rewriteHtml ? rewriteHtml(html) : html;
  }, [card.front, rewriteHtml]);

  const displayBackHtml = useMemo(() => {
    let html = stripSounds(card.back);
    return rewriteHtml ? rewriteHtml(html) : html;
  }, [card.back, rewriteHtml]);

  // ── Swipe-down dismiss ──────────────────────────────────────────────────
  const startYRef = useRef<number | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    if (!touch) return;
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    if (touch.clientY - rect.top > 48) return;
    startYRef.current = touch.clientY;
  }, []);

  const onTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (startYRef.current === null) return;
      const changedTouch = e.changedTouches[0];
      if (!changedTouch) return;
      const dy = changedTouch.clientY - startYRef.current;
      startYRef.current = null;
      if (dy > 100) onDismiss();
    },
    [onDismiss],
  );

  // ── Image insertion ─────────────────────────────────────────────────────

  const handleImageFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      e.target.value = '';

      if (isNativePlatform()) {
        // Save to filesystem — avoids embedding large base64 data URIs in the DB.
        const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
        const filename = `user_${crypto.randomUUID()}.${ext}`;
        const buffer = await file.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        await saveMediaFile(card.deckId, filename, bytes);
        const url = await getMediaFileWebUrl(card.deckId, filename);
        if (!url) return;

        userInsertedRef.current.set(url, filename);
        onMediaAdded?.(filename, url);

        const target = imageTargetRef.current === 'front' ? frontRef.current : backRef.current;
        if (!target) return;
        target.focus();
        const img = document.createElement('img');
        img.src = url;
        img.style.maxWidth = '100%';
        target.appendChild(img);
        editor.markContentDirty();
      } else {
        // Browser dev mode: embed as data URI (no Capacitor filesystem).
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === 'string') {
            const target = imageTargetRef.current === 'front' ? frontRef.current : backRef.current;
            if (!target) return;
            target.focus();
            const img = document.createElement('img');
            img.src = reader.result;
            img.style.maxWidth = '100%';
            target.appendChild(img);
            editor.markContentDirty();
          }
        };
        reader.readAsDataURL(file);
      }
    },
    [editor, card.deckId, onMediaAdded],
  );

  const handleAddImage = useCallback(
    (side: 'front' | 'back') => {
      imageTargetRef.current = side;
      imageInputRef.current?.click();
    },
    [],
  );

  // ── Handlers ────────────────────────────────────────────────────────────
  const handleSave = useCallback(() => {
    let front = frontRef.current?.innerHTML ?? card.front;
    let back = backRef.current?.innerHTML ?? card.back;

    // Convert blob: / capacitor: URLs back to filenames for storage.
    // Merge the static reverse map (from rewriteHtml) with any URLs for
    // images the user inserted during this editing session.
    const fullReverseMap = userInsertedRef.current.size > 0
      ? new Map([...reverseMap, ...userInsertedRef.current])
      : reverseMap;
    front = unrewriteHtml(front, fullReverseMap);
    back = unrewriteHtml(back, fullReverseMap);

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
  }, [editor, card.front, card.back, reverseMap, frontRefs, backRefs, onSave]);

  const handleDelete = useCallback(() => {
    const result = editor.remove();
    if (result.success) {
      onDelete();
    } else {
      setError(result.error);
    }
  }, [editor, onDelete]);


  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-40"
        onClick={onDismiss}
      />

      {/* Hidden file input for image picker */}
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
        className="card-editor-panel fixed left-0 right-0 bottom-0 z-50 bg-background-light dark:bg-background-dark rounded-t-2xl shadow-2xl max-h-[85dvh] flex flex-col"
        style={{
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
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
            {isNew ? 'New Card' : 'Edit Card'}
          </span>
          <button
            onClick={handleSave}
            disabled={!isNew && !editor.dirty}
            className={`text-sm font-semibold ${
              isNew || editor.dirty
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
            initialHtml={displayFrontHtml}
            contentRef={frontRef}
            onInput={editor.markContentDirty}
          />
          <button
            type="button"
            onClick={() => handleAddImage('front')}
            className="w-full py-1.5 text-xs text-text-muted border border-dashed border-border-light dark:border-border-dark rounded-lg"
          >
            Add Image to Front...
          </button>

          {/* Front Media Inventory */}
          <MediaInventory refs={frontRefs} side="Front" rewriteHtml={rewriteHtml} />

          {/* Back */}
          <RichField
            label="Back"
            initialHtml={displayBackHtml}
            contentRef={backRef}
            onInput={editor.markContentDirty}
          />
          <button
            type="button"
            onClick={() => handleAddImage('back')}
            className="w-full py-1.5 text-xs text-text-muted border border-dashed border-border-light dark:border-border-dark rounded-lg"
          >
            Add Image to Back...
          </button>

          {/* Back Media Inventory */}
          <MediaInventory refs={backRefs} side="Back" rewriteHtml={rewriteHtml} />

          {/* Tags — toggle pills from deck's tag list */}
          {deckTags.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-text-muted mb-2">Tags</label>
              <div className="flex flex-wrap gap-1.5">
                {deckTags.map(tc => {
                  const isOn = editor.tags.includes(tc.tag);
                  const bg = tc.color || '#9E9E9E';
                  const textCol = tc.color ? pillTextColor(tc.color) : '#ffffff';
                  return (
                    <button
                      key={tc.tag}
                      onClick={() => {
                        if (isOn) {
                          const idx = editor.tags.indexOf(tc.tag);
                          if (idx !== -1) editor.removeTag(idx);
                        } else {
                          editor.addTag(tc.tag);
                        }
                      }}
                      className="px-2.5 py-1 text-xs rounded-full transition-all active:scale-95"
                      style={isOn
                        ? { background: bg, color: textCol, boxShadow: `0 0 0 2px var(--kit-bg), 0 0 0 3.5px ${bg}` }
                        : { background: bg, color: textCol, opacity: 0.35 }
                      }
                    >
                      {tc.tag}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Delete Card */}
          {isNew ? null : !showDeleteConfirm ? (
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
      </div>
    </>
  );
}
