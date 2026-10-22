import { useEffect, useRef, useState } from 'react';
import type { LibrarySearchDismissalPointer, LibrarySearchOptions, LibrarySearchPresentation } from '../types/librarySearch';

const CLOSING_DURATION = 180;

/** Present browser search and dismiss it without activating the content underneath.
 * @param options - Current open/native state and a close callback that owns the query.
 * @returns Whether the web field remains mounted, and whether to apply its closing style.
 */
export function useLibrarySearch(options: LibrarySearchOptions): LibrarySearchPresentation {
  const { open, native } = options;
  const latest = useRef(options);
  const dismissed = useRef(false);
  const [retained, setRetained] = useState(open && !native);

  useEffect(() => { latest.current = options; });

  useEffect(() => {
    if (native) {
      setRetained(false);
      return;
    }
    if (open) {
      dismissed.current = false;
      setRetained(true);
      return;
    }
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (preference.matches) {
      setRetained(false);
      return;
    }
    const timer = window.setTimeout(() => setRetained(false), CLOSING_DURATION);
    const finishForReducedMotion = () => {
      if (!preference.matches) return;
      window.clearTimeout(timer);
      setRetained(false);
    };
    preference.addEventListener('change', finishForReducedMotion);
    return () => {
      window.clearTimeout(timer);
      preference.removeEventListener('change', finishForReducedMotion);
    };
  }, [open, native]);

  useEffect(() => {
    if (native) return;
    let pointer: LibrarySearchDismissalPointer | null = null;
    let suppressionTimer: number | undefined;

    const clearSuppression = () => {
      pointer = null;
      window.clearTimeout(suppressionTimer);
      suppressionTimer = undefined;
    };
    const expireSuppression = (milliseconds: number) => {
      window.clearTimeout(suppressionTimer);
      suppressionTimer = window.setTimeout(clearSuppression, milliseconds);
    };
    const consume = (event: Event) => {
      if (event.cancelable) event.preventDefault();
      event.stopPropagation();
    };
    const close = () => {
      if (dismissed.current || !latest.current.open || latest.current.native) return;
      dismissed.current = true;
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && focused.closest('#library-search')) focused.blur();
      latest.current.onClose();
    };
    const onPointerDown = (event: PointerEvent) => {
      // A fresh press belongs to a fresh intention, never to the previous tap's click.
      clearSuppression();
      if (!latest.current.open || latest.current.native || dismissed.current) return;
      if (!event.isPrimary || event.button !== 0) return;
      const target = event.target;
      if (target instanceof Element && target.closest('#library-search, .library-dock')) return;
      pointer = { id:event.pointerId, x:event.clientX, y:event.clientY };
      // Release normally shortens this guard. The fallback covers a lost pointer-up.
      expireSuppression(5000);
      consume(event);
      close();
    };
    const onPointerUp = (event: PointerEvent) => {
      if (!pointer || event.pointerId !== pointer.id) return;
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      consume(event);
      // Safari can synthesize click after pointer-up even when pointer-down was cancelled.
      expireSuppression(450);
    };
    const onPointerCancel = (event: PointerEvent) => {
      if (!pointer || event.pointerId !== pointer.id) return;
      consume(event);
      expireSuppression(450);
    };
    const onClick = (event: MouseEvent) => {
      if (!pointer || event.detail === 0) return;
      if ('pointerId' in event && typeof event.pointerId === 'number'
        && event.pointerId > 0 && event.pointerId !== pointer.id) return;
      if (Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 24) return;
      consume(event);
      clearSuppression();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !latest.current.open || dismissed.current) return;
      consume(event);
      close();
    };
    const onVisibility = () => { if (document.hidden) clearSuppression(); };

    // These listeners remain through the closing frame to consume the original click.
    // With search closed they do nothing, apart from finishing that one pointer sequence.
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointerup', onPointerUp, true);
    document.addEventListener('pointercancel', onPointerCancel, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', clearSuppression);
    return () => {
      clearSuppression();
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('pointerup', onPointerUp, true);
      document.removeEventListener('pointercancel', onPointerCancel, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', clearSuppression);
    };
  }, [native]);

  return {
    mounted:!native && (open || retained),
    closing:!native && !open && retained,
  };
}
