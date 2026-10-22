import { useLayoutEffect } from 'react';
import { moveCardEdge } from '../lib/cardEdgeFeedback';
import type { CardEdgeFeedbackOptions, CardEdgeTouch } from '../types/cardScroll';

const INTERACTIVE = 'button,a,input,textarea,select,audio,video,iframe,[contenteditable="true"],[data-hold-edit-actions]';

/** Add a small edge give while preserving native content scrolling and card turns.
 * @param options - The actual face scroller, its content identity and visibility.
 * @returns No React state; passive touch events update one bounded CSS transform.
 */
export function useCardEdgeFeedback({ scrollRef, contentKey, visible }: CardEdgeFeedbackOptions): void {
  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll || !visible || !CSS.supports('overscroll-behavior-y', 'none')) return;
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    let active: CardEdgeTouch | null = null;

    const clear = () => {
      active = null;
      // Retain this quiet reset marker until the next real pull. Removing and
      // restoring transition in one event would be coalesced by style resolution.
      scroll.setAttribute('data-card-edge-reset', 'true');
      scroll.removeAttribute('data-card-edge-dragging');
      scroll.style.removeProperty('--card-edge-transform');
    };
    const release = () => {
      if (!active) return;
      const offset = active.drag.offset;
      active = null;
      scroll.removeAttribute('data-card-edge-dragging');
      if (offset) scroll.style.setProperty('--card-edge-transform', 'translateY(0px)');
      else clear();
    };
    const blocked = () => preference.matches || document.hidden
      || Boolean(scroll.closest('[data-card-edit-lock="true"],.card-turn-frame--moving'));
    const ignores = (target: EventTarget | null) => {
      if (!(target instanceof Element) || target.closest(INTERACTIVE)) return true;
      for (let element: Element | null = target; element && element !== scroll; element = element.parentElement) {
        const overflow = getComputedStyle(element).overflowY;
        if (/(auto|scroll)/.test(overflow) && element.scrollHeight > element.clientHeight + 1) return true;
      }
      return false;
    };
    const start = (event: TouchEvent) => {
      clear();
      if (event.touches.length !== 1 || blocked() || ignores(event.target)) return;
      const touch = event.touches[0];
      if (!touch) return;
      active = { id:touch.identifier, drag:{ x:touch.clientX, y:touch.clientY, previousY:touch.clientY, axis:'pending', offset:0 } };
    };
    const move = (event: TouchEvent) => {
      if (!active) return;
      if (event.touches.length !== 1 || blocked()) { clear(); return; }
      const touch = [...event.touches].find(value => value.identifier === active?.id);
      if (!touch) { release(); return; }
      const next = moveCardEdge(active.drag, touch.clientX, touch.clientY, {
        top:scroll.scrollTop, height:scroll.clientHeight, contentHeight:scroll.scrollHeight,
      });
      active.drag = next;
      if (next.axis === 'horizontal') { release(); return; }
      if (next.offset || scroll.style.getPropertyValue('--card-edge-transform')) {
        scroll.removeAttribute('data-card-edge-reset');
        scroll.setAttribute('data-card-edge-dragging', 'true');
        scroll.style.setProperty('--card-edge-transform', `translateY(${next.offset}px)`);
      }
    };
    const finish = (event: TransitionEvent) => {
      if (event.target === scroll && event.propertyName === 'transform' && !active) clear();
    };
    const preferenceChanged = () => { if (preference.matches) clear(); };
    const hidden = () => { if (document.hidden) clear(); };
    scroll.addEventListener('touchstart', start, { passive:true });
    scroll.addEventListener('touchmove', move, { passive:true });
    scroll.addEventListener('touchend', release, { passive:true });
    scroll.addEventListener('touchcancel', release, { passive:true });
    scroll.addEventListener('transitionend', finish);
    preference.addEventListener('change', preferenceChanged);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      scroll.removeEventListener('touchstart', start);
      scroll.removeEventListener('touchmove', move);
      scroll.removeEventListener('touchend', release);
      scroll.removeEventListener('touchcancel', release);
      scroll.removeEventListener('transitionend', finish);
      preference.removeEventListener('change', preferenceChanged);
      document.removeEventListener('visibilitychange', hidden);
      clear();
    };
  }, [scrollRef, contentKey, visible]);
}
