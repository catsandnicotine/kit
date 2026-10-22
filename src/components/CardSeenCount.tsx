import type { CardSeenCountProps } from '../types/cardSeenUi';
import './CardSeenCount.css';

/** Show a quiet tracked count beside the face pair without changing its geometry.
 * @param props.count - Successfully persisted reveals, or unknown while loading.
 * @returns A compact visible count with an exact accessible description, or nothing at zero.
 */
export function CardSeenCount({ count }: CardSeenCountProps) {
  if (count === null || count === undefined || count <= 0) return null;
  const units = count >= 1_000_000 ? 1_000_000 : count >= 1_000 ? 1_000 : 1;
  const scaled = count / units;
  const abbreviated = units === 1 ? String(count) : `${scaled < 10 ? Math.floor(scaled * 10) / 10 : Math.floor(scaled)}${units === 1_000 ? 'k' : 'm'}`;
  const description = `Answer reveals: ${count.toLocaleString()}`;
  return <span className="card-seen-count" title={description}><span aria-hidden="true">×{abbreviated}</span><span className="sr-only">{description}</span></span>;
}
