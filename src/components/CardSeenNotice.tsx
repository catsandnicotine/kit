import type { CardSeenNoticeProps } from '../types/cardSeenUi';
import { LibraryNotice } from './LibraryNotice';
import './CardSeenCount.css';

/** Report one count-storage failure without resizing the active card or gesture frame.
 * @param props - A once-per-visit error and its existing automatic-dismiss callback.
 * @returns A notice above the card with no effect on captured gesture geometry.
 */
export function CardSeenNotice({ error, onDismiss }: CardSeenNoticeProps) {
  if (!error) return null;
  return <div className="study-count-notice"><LibraryNotice notice={{ source:'library', tone:'error', title:error, message:'You can keep studying.', details:'' }} onDismiss={onDismiss} /></div>;
}
