import type { PluginListenerHandle } from '@capacitor/core';

export type LibraryControlAction = 'settings' | 'add';

export interface NativeLibraryState {
  visible: boolean;
  searchOpen: boolean;
  searchQuery: string;
  addDisabled: boolean;
  appearance: 'light' | 'dark';
}

export interface NativeLibraryUpdate extends NativeLibraryState {
  session: string;
  revision: number;
}

export interface NativeLibraryActionEvent {
  session: string;
  action: LibraryControlAction;
}

export type NativeLibraryEvent = NativeLibraryActionEvent
  | { session: string; action: 'search'; open: boolean; query: string }
  | { session: string; action: 'query'; query: string }
  | { session: string; action: 'keyboard'; inset: number; duration: number };

export interface NativeLibraryPlugin {
  setState: (state: NativeLibraryUpdate) => Promise<void>;
  addListener: (event: 'action', listener: (event: NativeLibraryEvent) => void) => Promise<PluginListenerHandle>;
}

export interface NativeLibraryController {
  update: (state: NativeLibraryState) => Promise<boolean>;
  dispose: () => Promise<void>;
}

export interface NativeLibraryOptions extends NativeLibraryState {
  onSearchChange: (open: boolean, query: string) => void;
  onSettings: () => void;
  onAdd: () => void;
  onQuery: (query: string) => void;
}

export interface NativeLibraryLayout {
  ready: boolean;
  keyboardInset: number;
  keyboardDuration: number;
}
