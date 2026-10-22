import { TagLabel } from './TagLabel';
import type { CardTagRowProps } from '../types/tagUi';

/** Keep card metadata after its content, without covering diagrams or photographs.
 * @param props - Card tag names and their stored pigments.
 * @returns The shared compact labels, or nothing for an untagged card.
 */
export function CardTagRow({ tags, colors }: CardTagRowProps) {
  if (tags.length === 0) return null;
  return <div className="card-tag-row" aria-label="Card tags">{tags.map(tag => <TagLabel key={tag} name={tag} color={colors.get(tag)} compact />)}</div>;
}
