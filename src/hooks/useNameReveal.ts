import { useCallback, useEffect, useRef, useState, type PointerEvent, type MouseEvent } from 'react';
import { hapticLongPress } from '../lib/platform/haptics';

/** Reveal a full name on hold without opening the deck or interfering with scroll.
 * @returns Dialog state and pointer/context-menu handlers for the name.
 */
export function useNameReveal() {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef({x:0,y:0});
  const held = useRef(false);
  const cancel = useCallback(() => { if (timer.current) clearTimeout(timer.current); timer.current = null; }, []);
  useEffect(() => cancel, [cancel]);
  const reveal = () => { held.current = true; void hapticLongPress(); setOpen(true); };
  return {
    open, close: () => setOpen(false),
    handlers: {
      onPointerDown: (event: PointerEvent) => {
        if (event.button !== 0) return;
        cancel(); held.current = false; origin.current = {x:event.clientX,y:event.clientY};
        timer.current = setTimeout(reveal, 450);
      },
      onPointerMove: (event: PointerEvent) => { if (Math.hypot(event.clientX-origin.current.x,event.clientY-origin.current.y)>8) cancel(); },
      onPointerUp: cancel, onPointerCancel: cancel, onPointerLeave: cancel,
      onContextMenu: (event: MouseEvent) => { event.preventDefault(); event.stopPropagation(); cancel(); reveal(); },
      onClickCapture: (event: MouseEvent) => { if (held.current) { event.preventDefault(); event.stopPropagation(); held.current=false; } },
    },
  };
}
