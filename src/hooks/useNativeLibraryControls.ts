import { useEffect, useRef, useState } from 'react';
import { createLibraryControls } from '../lib/platform/libraryControls';
import type { NativeLibraryController, NativeLibraryLayout, NativeLibraryOptions } from '../types/nativeLibraryControls';

/** Keep native utility buttons in step with the current library and its dialogs.
 * @param options - Visibility, theme, readiness and existing interaction handlers.
 * @returns Native ownership and the keyboard's single, coordinated layout transition.
 */
export function useNativeLibraryControls(options: NativeLibraryOptions): NativeLibraryLayout {
  const latest = useRef(options);
  const controller = useRef<NativeLibraryController | null>(null);
  const [nativeReady, setNativeReady] = useState(false);
  const [keyboard, setKeyboard] = useState({ inset:0, duration:0 });
  useEffect(() => { latest.current = options; });
  useEffect(() => {
    controller.current = createLibraryControls(event => {
      const current = latest.current;
      if (event.action === 'keyboard') {
        setKeyboard({ inset:event.inset, duration:event.duration });
        return;
      }
      if (event.action === 'search') {
        if (!event.open || current.visible) current.onSearchChange(event.open, event.query);
        return;
      }
      if (!current.visible) return;
      const { action } = event;
      if (event.action === 'query') { current.onQuery(event.query); return; }
      if (action === 'settings') current.onSettings();
      else if (action === 'add' && !current.addDisabled) current.onAdd();
    });
    return () => {
      void controller.current?.dispose();
      controller.current = null;
    };
  }, []);
  const { visible, searchOpen, searchQuery, addDisabled, appearance } = options;
  useEffect(() => {
    const active = controller.current;
    if (!active) return;
    let cancelled = false;
    void active.update({ visible, searchOpen, searchQuery, addDisabled, appearance }).then(ready => {
      if (cancelled) return;
      setNativeReady(ready);
      if (!ready) {
        controller.current = null;
        void active.dispose();
      }
    });
    return () => { cancelled = true; };
  }, [visible, searchOpen, searchQuery, addDisabled, appearance]);
  return { ready:nativeReady, keyboardInset:nativeReady ? keyboard.inset : 0, keyboardDuration:keyboard.duration };
}
