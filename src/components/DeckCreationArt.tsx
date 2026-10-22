/** Small paper objects that echo Kit's written-card and eye-card faces.
 * @param props.kind - Making personal cards or bringing in an Anki deck.
 * @returns A decorative pixel drawing; the enclosing action provides its label.
 */
export function DeckCreationArt({ kind }: { kind: 'make' | 'import' }) {
  return <svg className="deck-creation-art" width="64" height="64" viewBox="0 0 40 40" shapeRendering="crispEdges" aria-hidden="true" focusable="false">
    {kind === 'make' ? <>
      <path fill="#506359" d="M5 10h20l4 4v21H5Z" /><path fill="#83978a" d="M6 10h19v2H6Zm-1 2h2v21H5Z" />
      <path fill="#c5c9b5" d="M12 4h16l6 6v22H12Z" /><path fill="#e9e8d5" d="M13 5h14v6h6v19H13Z" />
      <path fill="#a4afa0" d="M28 5v5h5Z" /><path fill="#536658" d="M17 14h12v2H17Zm0 5h10v2H17Zm0 5h7v2h-7Z" />
      <path fill="#f7f5e7" d="M13 5h14v1H13Z" />
    </> : <>
      <path fill="#657a6b" d="M10 5h17l5 5v16H10Z" /><path fill="#b7c4b2" d="M12 3h15l6 6v15H12Z" />
      <path fill="#e3e5d1" d="M14 4h12v6h6v12H14Z" /><path fill="#9aa993" d="M27 4v5h5Z" />
      <path fill="#547361" d="M20 13h4v10h4v2h-2v2h-2v2h-4v-2h-2v-2h-2v-2h4Z" />
      <path fill="#b8d0ba" d="M21 13h1v11h-4v1h2v2h2v-2h2v-1h-3Z" />
      <path fill="#7f927c" d="M6 26h3v7h24v-7h3v10H6Z" /><path fill="#d7ddc5" d="M6 26h3v2H6Zm27 0h3v2h-3ZM9 33h24v1H9Z" />
    </>}
  </svg>;
}
