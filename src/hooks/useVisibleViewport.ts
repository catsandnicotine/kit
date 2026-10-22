import { useLayoutEffect, useState } from 'react';

/** Keep bottom search controls above the software keyboard when it resizes the view.
 * @param enabled - Observe only while the library search field is open.
 * @returns The visible bottom edge in CSS pixels, or null for ordinary layout.
 */
export function useVisibleViewport(enabled: boolean): number | null {
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const viewport = window.visualViewport;
    if (!enabled || !viewport) return;
    const measure = () => {
      const bottom = Math.round(Math.min(window.innerHeight, viewport.height + viewport.offsetTop));
      setHeight(previous => previous === bottom ? previous : bottom);
    };
    measure();
    viewport.addEventListener('resize', measure, { passive:true });
    viewport.addEventListener('scroll', measure, { passive:true });
    return () => { viewport.removeEventListener('resize', measure); viewport.removeEventListener('scroll', measure); };
  }, [enabled]);
  return enabled ? height : null;
}
