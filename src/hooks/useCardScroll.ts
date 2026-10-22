import { useLayoutEffect, useRef, useState } from 'react';
import { useCardEdgeFeedback } from './useCardEdgeFeedback';

/** Observe the lower edge of one card face without a polling or animation loop.
 * @param contentKey - Rendered face content; a replacement starts at the top.
 * @param visible - Only the currently visible face needs a scroll cue.
 * @returns Scroll/body refs and whether unread content continues below.
 */
export function useCardScroll(contentKey: string, visible: boolean) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [moreBelow, setMoreBelow] = useState(false);
  useCardEdgeFeedback({ scrollRef, contentKey, visible });

  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [contentKey]);

  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    const body = bodyRef.current;
    if (!scroll || !body || !visible) return;
    const measure = () => {
      const more = scroll.clientHeight > 0
        && scroll.scrollHeight - scroll.clientHeight - Math.max(0, scroll.scrollTop) > 2;
      setMoreBelow(previous => previous === more ? previous : more);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroll);
    observer.observe(body);
    scroll.addEventListener('scroll', measure, { passive: true });
    // Captured media load catches intrinsic image sizing after HTML injection.
    body.addEventListener('load', measure, true);
    return () => {
      observer.disconnect();
      scroll.removeEventListener('scroll', measure);
      body.removeEventListener('load', measure, true);
    };
  }, [contentKey, visible]);

  return { scrollRef, bodyRef, moreBelow: visible && moreBelow };
}
