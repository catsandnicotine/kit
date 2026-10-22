/** Media that can be inserted as an ordered card section. */
export type CardMediaKind = 'image' | 'video';

/** Durable media reference; only filename belongs in saved card HTML. */
export interface SavedCardMedia {
  filename: string;
  url: string;
  kind: CardMediaKind;
}

/** Canonical storage extension and section kind inferred from an explicit File. */
export interface CardMediaFileFormat {
  extension: string;
  kind: CardMediaKind;
}

/** Native files are copied locally before this response crosses the bridge. */
export interface NativeMediaPasteResponse {
  items: SavedCardMedia[];
}

/** Clipboard operations are invoked only by an explicit user Paste or Copy action. */
export interface MediaClipboardPlugin {
  paste: (options: { deckId: string }) => Promise<NativeMediaPasteResponse>;
  copy: (options: { deckId: string; filename: string; displayUrl: string; kind: CardMediaKind }) => Promise<void>;
}
