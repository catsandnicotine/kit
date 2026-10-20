import type { UiIconName } from '../types/ui';

const PATHS: Record<UiIconName, string> = {
  close:'m6 6 12 12M18 6 6 18', check:'m5 12 4 4L19 6',
  image:'M4 4h16v16H4ZM4 16l5-5 4 4 3-3 4 4M8 8h.01',
  repeat:'M4 10a8 8 0 1 1 1 8M4 4v6h6', arrow:'M5 12h14m-6-6 6 6-6 6',
  plus:'M12 5v14M5 12h14', import:'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
  trash:'M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7',
};

/** A quiet utility icon with its accessible name supplied by the parent control.
 * @param props.name - Utility action to depict.
 * @returns A decorative 17px icon; touch targets are sized independently.
 */
export function UiIcon({ name }: { name: UiIconName }) {
  return <svg className="kit-utility-icon" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={PATHS[name]} /></svg>;
}
