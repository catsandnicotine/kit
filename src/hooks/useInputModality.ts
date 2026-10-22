import { useEffect } from 'react';

/** Keep restored control focus quiet after a tap, and visible for keyboard use.
 * @returns Nothing; input modality is exposed only to the shared focus styles.
 */
export function useInputModality(): void {
  useEffect(() => {
    const root = document.documentElement;
    const pointer = () => { root.dataset.inputModality = 'pointer'; };
    const keyboard = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || ['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return;
      root.dataset.inputModality = 'keyboard';
    };
    document.addEventListener('pointerdown', pointer, true);
    document.addEventListener('keydown', keyboard, true);
    return () => {
      document.removeEventListener('pointerdown', pointer, true);
      document.removeEventListener('keydown', keyboard, true);
      delete root.dataset.inputModality;
    };
  }, []);
}
