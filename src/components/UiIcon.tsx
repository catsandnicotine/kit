import type { UiIconName } from '../types/ui';

const PATHS: Record<UiIconName, string> = {
  close:'m6 6 12 12M18 6 6 18', check:'m5 12 4 4L19 6',
  image:'M4 4h16v16H4ZM4 16l5-5 4 4 3-3 4 4M8 8h.01',
  repeat:'M4 10a8 8 0 1 1 1 8M4 4v6h6', arrow:'M5 12h14m-6-6 6 6-6 6',
  plus:'M12 5v14M5 12h14', import:'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
  trash:'M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7',
  back:'m14 5-7 7 7 7',
  more:'M5 12h.01M12 12h.01M19 12h.01',
  tags:'M5 4h12l3 3v11H5ZM17 4v3h3M2 8v13h14M8 10h5M8 13h8',
  settings:'m9.6 3 .6-1h3.6l.6 3 2.1 1.2 2.9-.9 1.8 3.1-2.3 2.1v2.4l2.3 2.1-1.8 3.1-2.9-.9-2.1 1.2-.6 3h-3.6l-.6-3-2.1-1.2-2.9.9-1.8-3.1 2.3-2.1v-2.4L2.8 8.5l1.8-3.1 2.9.9 2.1-1.2ZM15.5 12a3.5 3.5 0 1 1-7 0 3.5 3.5 0 1 1 7 0',
  search:'M18 10.5a7.5 7.5 0 1 1-15 0 7.5 7.5 0 1 1 15 0ZM16 16l5 5',
  cards:'M8 3h12v15H8ZM4 7v14h12M11 7h6M11 10h4',
  arrange:'M8 4v16m-4-4 4 4 4-4M16 20V4m-4 4 4-4 4 4',
  grip:'M8 5h.01M16 5h.01M8 12h.01M16 12h.01M8 19h.01M16 19h.01',
  up:'m6 15 6-6 6 6', down:'m6 9 6 6 6-6',
  copy:'M8 8h12v13H8ZM16 4V2H3v15h2',
  paste:'M9 4H5v17h14V4h-4M9 2h6v5H9ZM8 11h8M8 15h5',
};

/** A quiet utility icon with its accessible name supplied by the parent control.
 * @param props.name - Utility action to depict.
 * @returns A decorative 17px icon; touch targets are sized independently.
 */
export function UiIcon({ name }: { name: UiIconName }) {
  return <svg className="kit-utility-icon" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={PATHS[name]} /></svg>;
}
