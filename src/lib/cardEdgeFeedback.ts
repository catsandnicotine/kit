import { cardTurnAxis } from './cardTurn';
import type { CardEdgeDrag, CardEdgeMetrics } from '../types/cardScroll';

/** Follow one vertical edge pull without changing the native scroll position.
 * @param drag - Starting touch and its previous visual displacement.
 * @param x - Current finger position across the screen.
 * @param y - Current finger position down the screen.
 * @param metrics - The native scroller's current content and viewport bounds.
 * @returns Once-locked intent and a resistant displacement of at most 20px.
 */
export function moveCardEdge(drag: CardEdgeDrag, x: number, y: number, metrics: CardEdgeMetrics): CardEdgeDrag {
  const axis = drag.axis === 'pending' ? cardTurnAxis(x - drag.x, y - drag.y) : drag.axis;
  const next = { ...drag, previousY:y, axis, offset:0 };
  if (axis !== 'vertical' || ![drag.x, drag.y, drag.previousY, drag.offset, x, y, metrics.top, metrics.height, metrics.contentHeight].every(Number.isFinite)) return next;
  const delta = y - drag.previousY;
  const maxTop = Math.max(0, metrics.contentHeight - metrics.height);
  const atTop = metrics.top <= 1;
  const atBottom = metrics.top >= maxTop - 1;
  const limit = Math.min(20, Math.max(0, metrics.height) * .06);
  if (!limit || (!atTop && !atBottom)) return next;
  // Only the edge takes extra travel; actual content scroll remains WebKit's job.
  const outward = delta > 0 ? atTop : atBottom;
  let offset = drag.offset;
  if (outward && (!offset || Math.sign(delta) === Math.sign(offset))) {
    offset += delta * .2 * Math.max(0, 1 - Math.abs(offset) / limit);
  } else if (offset && Math.sign(delta) !== Math.sign(offset)) {
    offset = Math.sign(offset) * Math.max(0, Math.abs(offset) - Math.abs(delta) * .4);
  } else offset = 0;
  next.offset = Math.max(-limit, Math.min(limit, offset));
  return next;
}
