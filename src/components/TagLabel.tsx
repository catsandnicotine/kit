import type { TagLabelProps, TagLabelStyle } from '../types/tagUi';
import { pillTextColor } from '../lib/tagColors';
import './TagLabel.css';

/** A small painted-paper label, shared by the catalogue, editor and card faces.
 * @param props - Tag text, its stored pigment, and optional compact typography.
 * @returns One quiet cartellino silhouette with a crease and lifted corner.
 */
export function TagLabel({ name, color, compact = false }: TagLabelProps) {
  const pigment = color || '#747b69';
  const style: TagLabelStyle = { '--tag-pigment':pigment, color:pillTextColor(pigment) };
  return <span className={`tag-label${compact ? ' tag-label--compact' : ''}`} style={style}>{name}</span>;
}
