/** Native file metadata prepared for exactly one navigation, without media bytes. */
export interface DeckMediaBootstrap {
  readonly deckId: string;
  readonly filenames: readonly string[];
  readonly dirUri: string;
}

export interface UseDeckMediaReturn {
  /** Rewrite rendered card media references using the current deck's local URLs. */
  rewriteHtml: (html: string) => string;
  /** True only while the local filenames and URL metadata are being prepared. */
  loading: boolean;
  /** Register a newly saved attachment immediately, without rescanning the deck. */
  addMediaFile: (filename: string, url: string) => void;
}
