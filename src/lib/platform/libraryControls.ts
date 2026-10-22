import { Capacitor, registerPlugin } from '@capacitor/core';
import type { NativeLibraryController, NativeLibraryEvent, NativeLibraryPlugin, NativeLibraryState } from '../../types/nativeLibraryControls';

const plugin = registerPlugin<NativeLibraryPlugin>('LibraryControls');
let revision = 0;
let operations: Promise<unknown> = Promise.resolve();

/** Attach native controls, serializing screen changes so an old screen cannot hide a new one.
 * @param onAction - Current library action dispatcher.
 * @returns An iOS controller, or null for the browser's accessible fallback.
 */
export function createLibraryControls(onAction: (event: NativeLibraryEvent) => void): NativeLibraryController | null {
  if (Capacitor.getPlatform() !== 'ios' || !Capacitor.isPluginAvailable('LibraryControls')) return null;
  const session = crypto.randomUUID();
  let disposed = false;
  let disposal: Promise<void> | null = null;
  let lastState: NativeLibraryState = { visible:false, searchOpen:false, searchQuery:'', addDisabled:true, appearance:'dark' };
  // Convert listener rejection to a result immediately, including disposal before the first update.
  const listener = plugin.addListener('action', event => {
    if (!disposed && event.session === session) onAction(event);
  }).then(handle => ({ handle }), error => {
    console.error('Native library listener unavailable', error);
    return { handle:null };
  });

  return {
    update(state) {
      lastState = state;
      const operation = operations.then(async () => {
        try {
          if (disposed) return false;
          const { handle } = await listener;
          if (!handle || disposed) return false;
          await plugin.setState({ ...state, session, revision:++revision });
          return !disposed;
        } catch (error) {
          console.error('Native library controls unavailable; using web controls', error);
          return false;
        }
      });
      operations = operation;
      return operation;
    },
    dispose() {
      if (disposal) return disposal;
      disposed = true;
      const operation = operations.then(async () => {
        try {
          await plugin.setState({ ...lastState, visible:false, session, revision:++revision });
        } catch (error) {
          console.error('Could not dismiss native library controls', error);
        }
        try {
          const { handle } = await listener;
          await handle?.remove();
        } catch (error) {
          console.error('Could not release native library listener', error);
        }
      });
      operations = operation;
      disposal = operation;
      return disposal;
    },
  };
}
