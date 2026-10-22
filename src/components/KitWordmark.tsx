import './KitWordmark.css';

/** The original KI lettering with one balanced, continuous cross drawing.
 * @param props.quiet - Dim KI on supporting screens while retaining the same t.
 * @returns An accessible Kit mark; the parent centers its narrow t-sized box.
 */
export function KitWordmark({ quiet = false }: { quiet?: boolean }) {
  return <span className={`kit-wordmark${quiet ? ' kit-wordmark--quiet' : ''}`} role="img" aria-label="Kit">
    <span className="kit-wordmark-letters" aria-hidden="true"><span>KI</span></span>
    <svg className="kit-wordmark-t" width="7" height="10" viewBox="0 0 16 24" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M6 0h4v6h6v4h-6v14H6V10H0V6h6Z" />
    </svg>
  </span>;
}
