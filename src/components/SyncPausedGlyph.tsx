/** Mark paused sync with two small, clearly separated pause strokes.
 * @returns A compact pixel symbol that does not imply a Wi-Fi failure.
 */
export function SyncPausedGlyph() {
  return <svg className="sync-notice-icon" width="26" height="26" viewBox="0 0 28 28" fill="currentColor" shapeRendering="crispEdges" aria-hidden="true" focusable="false">
    <path d="M7 4h4v1h1v18h-1v1H7v-1H6V5h1ZM18 4h4v1h1v18h-1v1h-4v-1h-1V5h1Z" />
    <path fill="#fff8e5" opacity=".35" d="M7 4h4v1H7ZM6 5h1v17H6ZM18 4h4v1h-4ZM17 5h1v17h-1Z" />
    <path fill="#736651" opacity=".25" d="M7 23h4v1H7ZM18 23h4v1h-4Z" />
  </svg>;
}
