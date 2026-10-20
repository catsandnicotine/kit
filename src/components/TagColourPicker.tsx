import { getTagPickerColours, pillTextColor } from '../lib/tagColors';
import { UiIcon } from './UiIcon';

/** A small palette with generous touch targets and no selection rings.
 * @param props - Current colour and a callback receiving the selected/cleared colour.
 * @returns Eight everyday swatches, preserving any existing custom shade.
 */
export function TagColourPicker({ value, onChange }: { value:string; onChange:(value:string) => void }) {
  return <div className="tag-colour-picker" role="group" aria-label="Tag colour">{getTagPickerColours(value).map(shade => <button key={shade.hex} type="button" aria-label={shade.name} title={shade.name} aria-pressed={value.toLowerCase() === shade.hex.toLowerCase()} onClick={() => onChange(value.toLowerCase() === shade.hex.toLowerCase() ? '' : shade.hex)}>
    <span style={{ background:shade.hex, color:pillTextColor(shade.hex) }}>{value.toLowerCase() === shade.hex.toLowerCase() && <UiIcon name="check" />}</span>
  </button>)}</div>;
}
