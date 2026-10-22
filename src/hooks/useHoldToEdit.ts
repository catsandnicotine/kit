import { useCallback, useEffect, useRef, useState } from 'react';
import type { HoldEditPoint, HoldToEditBindings, HoldToEditOptions } from '../types/editorUi';
import { hapticLongPress } from '../lib/platform/haptics';

const INTERACTIVE = 'button,a,input,textarea,select,summary,audio,video,[contenteditable="true"]';
const EDIT_ACTIONS = '[data-hold-edit-actions]';

/** Recognize an intentional hold, then keep its edit offer stable until resolved.
 * @param options - Current card/face identity, edit callback and interaction guard.
 * @returns Progressive feedback, a locked edit offer, and explicit edit/dismiss actions.
 */
export function useHoldToEdit({ onEdit, disabled = false, identity }: HoldToEditOptions) {
  const [holding, setHolding] = useState(false);
  const [activated, setActivated] = useState(false);
  const [offered, setOffered] = useState(false);
  const [point, setPoint] = useState<HoldEditPoint | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const frame = useRef<HTMLElement | null>(null);
  const suppress = useRef(false);
  const lockedRef = useRef(false);
  const latest = useRef(onEdit);
  latest.current = onEdit;

  const clearSelection = useCallback(() => {
    const selection = window.getSelection();
    const surface = frame.current;
    if (surface && selection && (surface.contains(selection.anchorNode) || surface.contains(selection.focusNode))) selection.removeAllRanges();
  }, []);
  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
    setHolding(false);
  }, []);
  const reset = useCallback(() => {
    cancel();
    if (openTimer.current) clearTimeout(openTimer.current);
    openTimer.current = null;
    lockedRef.current = false;
    setActivated(false);
    setOffered(false);
    setPoint(null);
    suppress.current = false;
  }, [cancel]);
  const dismiss = useCallback(() => {
    const restoreFocus = lockedRef.current;
    reset();
    // Ordinary horizontal intent only cancels a pending hold. Focusing during
    // that captured pan needlessly asks WebKit to coordinate native scrolling.
    if (restoreFocus) frame.current?.focus({ preventScroll:true });
  }, [reset]);

  useEffect(() => { reset(); return reset; }, [identity, disabled, reset]);
  useEffect(() => {
    const interrupt = () => { if (!lockedRef.current) cancel(); };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !lockedRef.current) return;
      event.preventDefault(); event.stopPropagation(); dismiss();
    };
    const hide = () => { if (document.hidden) reset(); };
    document.addEventListener('scroll', interrupt, true);
    document.addEventListener('visibilitychange', hide);
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('scroll', interrupt, true);
      document.removeEventListener('visibilitychange', hide);
      document.removeEventListener('keydown', escape, true);
    };
  }, [cancel, dismiss, reset]);

  const locked = activated || offered;
  useEffect(() => {
    if (!locked) return;
    const surface = frame.current;
    const scope = surface?.closest<HTMLElement>('.study-session');
    if (!surface || !scope) return;
    const oldLock = scope.getAttribute('data-card-edit-lock');
    scope.setAttribute('data-card-edit-lock', 'true');
    const scrollPositions = [...surface.querySelectorAll<HTMLElement>('.card-scroll-viewport')]
      .map(element => ({ element, top:element.scrollTop, left:element.scrollLeft }));
    const inertControls = [...scope.querySelectorAll<HTMLElement>('button,a,input,textarea,select,[tabindex]')]
      .filter(element => element !== surface && !element.closest(EDIT_ACTIONS)
        && !element.matches('button[aria-label="Back"]'))
      .map(element => ({ element, inert:element.inert }));
    for (const { element } of inertControls) element.inert = true;

    const inActions = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest(EDIT_ACTIONS));
    const isBack = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest('button[aria-label="Back"]'));
    const inScope = (target: EventTarget | null) => target instanceof Node && scope.contains(target);
    const consume = (event: Event) => { if (event.cancelable) event.preventDefault(); event.stopPropagation(); };
    const block = (event: Event) => {
      if (!lockedRef.current || !inScope(event.target) || inActions(event.target) || isBack(event.target)) return;
      consume(event);
    };
    const click = (event: MouseEvent) => {
      if (!lockedRef.current || !inScope(event.target) || inActions(event.target)) return;
      consume(event);
      if (isBack(event.target)) dismiss();
    };
    const keys = (event: KeyboardEvent) => {
      if (!lockedRef.current || !inScope(event.target) || inActions(event.target) || isBack(event.target)
        || event.key === 'Tab' || event.key === 'Escape') return;
      consume(event);
    };
    const freezeScroll = () => {
      if (!lockedRef.current) return;
      for (const { element, top, left } of scrollPositions) {
        if (element.scrollTop !== top) element.scrollTop = top;
        if (element.scrollLeft !== left) element.scrollLeft = left;
      }
    };
    document.addEventListener('pointerdown', block, true);
    document.addEventListener('pointermove', block, true);
    document.addEventListener('pointerup', block, true);
    document.addEventListener('click', click, true);
    document.addEventListener('contextmenu', block, true);
    document.addEventListener('keydown', keys, true);
    document.addEventListener('touchmove', block, { capture:true, passive:false });
    document.addEventListener('wheel', block, { capture:true, passive:false });
    document.addEventListener('scroll', freezeScroll, true);
    document.addEventListener('selectionchange', clearSelection);
    return () => {
      if (oldLock === null) scope.removeAttribute('data-card-edit-lock');
      else scope.setAttribute('data-card-edit-lock', oldLock);
      for (const { element, inert } of inertControls) element.inert = inert;
      document.removeEventListener('pointerdown', block, true);
      document.removeEventListener('pointermove', block, true);
      document.removeEventListener('pointerup', block, true);
      document.removeEventListener('click', click, true);
      document.removeEventListener('contextmenu', block, true);
      document.removeEventListener('keydown', keys, true);
      document.removeEventListener('touchmove', block, true);
      document.removeEventListener('wheel', block, true);
      document.removeEventListener('scroll', freezeScroll, true);
      document.removeEventListener('selectionchange', clearSelection);
    };
  }, [locked, clearSelection, dismiss]);

  const offerEdit = useCallback(() => {
    if (disabled || lockedRef.current) return;
    clearSelection();
    cancel();
    suppress.current = true;
    lockedRef.current = true;
    setActivated(true);
    void hapticLongPress();
    // The filled stitch holds for one quiet 90ms acknowledgment before its action strip.
    openTimer.current = setTimeout(() => { openTimer.current = null; setActivated(false); setOffered(true); }, 90);
  }, [cancel, clearSelection, disabled]);
  const edit = useCallback(() => {
    if (disabled) return;
    reset();
    latest.current();
  }, [disabled, reset]);

  const bindings: HoldToEditBindings = {
    onPointerDown: event => {
      if (event.target instanceof Element && event.target.closest(INTERACTIVE)) return;
      if (lockedRef.current) { event.preventDefault(); event.stopPropagation(); return; }
      reset();
      if (disabled || !event.isPrimary || event.button !== 0) return;
      frame.current = event.currentTarget;
      clearSelection();
      const bounds = event.currentTarget.getBoundingClientRect();
      // The 116px cue stays around the thumb, inside each usable edge.
      const insetX = Math.min(58, bounds.width / 2);
      const insetY = Math.min(58, bounds.height / 2);
      setPoint({
        x:Math.min(Math.max(insetX, event.clientX - bounds.left), bounds.width - insetX),
        y:Math.min(Math.max(insetY, event.clientY - bounds.top), bounds.height - insetY),
      });
      setHolding(true);
      start.current = { x:event.clientX, y:event.clientY, id:event.pointerId };
      timer.current = setTimeout(offerEdit, 450);
    },
    onPointerMove: event => {
      if (lockedRef.current) { event.preventDefault(); return; }
      const origin = start.current;
      if (origin && (event.pointerId !== origin.id || Math.hypot(event.clientX-origin.x,event.clientY-origin.y) > 10)) cancel();
    },
    onPointerUp:cancel,
    onPointerLeave:cancel,
    onPointerCancel:cancel,
    onClickCapture: event => {
      if (event.target instanceof Element && event.target.closest(EDIT_ACTIONS)) return;
      if (suppress.current || lockedRef.current) { event.preventDefault(); event.stopPropagation(); }
    },
    onContextMenu: event => {
      if (event.target instanceof Element && event.target.closest('input,textarea,[contenteditable="true"]')) return;
      event.preventDefault();
      clearSelection();
      if (disabled || lockedRef.current || (event.target instanceof Element && event.target.closest(INTERACTIVE))) return;
      frame.current = event.currentTarget;
      offerEdit();
    },
  };
  return { bindings, holding, point, activated, offered, locked, edit, dismiss };
}
