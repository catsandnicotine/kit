import { useCardScroll } from '../hooks/useCardScroll';
import type { CardScrollFrameProps } from '../types/cardScroll';
import './CardScrollFrame.css';

/** Keep the lower-edge fade ready before content has finished sizing.
 * @param props - Face content, its replacement key, and current visibility.
 * @returns A persistent static fade and a cue only while more remains below.
 */
export function CardScrollFrame({ children, contentKey, visible }: CardScrollFrameProps) {
  const { scrollRef, bodyRef, moreBelow } = useCardScroll(contentKey, visible);
  return <div className={`card-scroll-frame ${visible ? '' : 'card-face-hidden'}`}>
    <div ref={scrollRef} className="card-content card-scroll-viewport">
      <div ref={bodyRef} className="card-scroll-body">{children}</div>
    </div>
    <div className="card-scroll-edge" aria-hidden="true">
      {moreBelow && <svg width="12" height="8" viewBox="0 0 12 8" fill="none"><path d="m2 2 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
    </div>
  </div>;
}
