import type { DeckGlyphProps } from '../types/ui';
import './DeckGlyph.css';

/** A small card folio; closed in the library, open within a deck.
 * @param props.open - Whether the user is already inside this deck.
 * @returns A decorative pair of paper silhouettes, never another control.
 */
export function DeckGlyph({ open = false }: DeckGlyphProps) {
  return <svg className={`deck-glyph${open ? ' deck-glyph--open' : ''}`} width="24" height="26" viewBox="0 0 26 28" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <g className="deck-glyph-closed">
      <path className="deck-glyph-pages" d="M9 3h12v18M6 5h12v18" />
      <rect className="deck-glyph-cover" x="3" y="8" width="12" height="17" rx="1.4" />
      <path className="deck-glyph-spine" d="M6 8v17" />
    </g>
    <g className="deck-glyph-open">
      <path className="deck-glyph-pages" d="M8 3h12v17M5 6h12v16" />
      <path className="deck-glyph-cover" d="M3 11h18l-4 14H1l2-14Z" />
      <path className="deck-glyph-spine" d="m6 11-3 14" />
    </g>
  </svg>;
}
