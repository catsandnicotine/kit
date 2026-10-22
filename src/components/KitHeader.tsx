import type { KitHeaderProps } from '../types/kitHeader';
import { KitWordmark } from './KitWordmark';
import './KitHeader.css';

/** Keep the Kit mark at one screen position across pages and full-screen dialogs.
 * @param props - Optional edge controls; quiet only dims KI, never resizes the mark.
 * @returns A shared safe-area header with a viewport-centred cross.
 */
export function KitHeader({ leading, trailing, quiet = false }: KitHeaderProps) {
  return <header className="kit-brand-header">
    <div className="kit-brand-leading">{leading}</div>
    <span className="kit-brand-mark"><KitWordmark quiet={quiet} /></span>
    <div className="kit-brand-trailing">{trailing}</div>
  </header>;
}
