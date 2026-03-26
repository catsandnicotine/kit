import { useEffect, type RefObject } from 'react';

/**
 * Calls `onOutsideClick` when the user taps/clicks outside the given element.
 * Only active when `enabled` is true — pass `open` state to avoid attaching
 * listeners when the menu/dropdown is closed.
 *
 * @param ref            - Ref to the element to track.
 * @param enabled        - Whether to listen (typically `open` state).
 * @param onOutsideClick - Callback invoked on an outside interaction.
 */
export function useClickOutside<T extends HTMLElement>(
  ref: RefObject<T | null>,
  enabled: boolean,
  onOutsideClick: () => void,
): void {
  useEffect(() => {
    if (!enabled) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onOutsideClick();
      }
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [ref, enabled, onOutsideClick]);
}
