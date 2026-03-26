/**
 * LaTeX / MathJax → KaTeX rendering for card HTML.
 *
 * Detects common math delimiters used by Anki decks:
 *   - \( ... \)   — MathJax inline math
 *   - \[ ... \]   — MathJax display math
 *   - $ ... $     — KaTeX / LaTeX inline math
 *   - $$ ... $$   — KaTeX / LaTeX display math
 *   - \begin{...} — LaTeX environments (align, equation, etc.)
 *
 * Renders each match with KaTeX. On parse failure, the raw LaTeX string
 * is shown in a styled <code> element rather than swallowed silently.
 *
 * This module has ZERO imports from React, UI, or platform code.
 */

import katex from 'katex';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Process card HTML, replacing all math delimiters with rendered KaTeX HTML.
 *
 * @param html - Card HTML that may contain LaTeX/MathJax notation.
 * @returns HTML with math expressions rendered via KaTeX.
 */
export function renderMath(html: string): string {
  if (!containsMath(html)) return html;

  let result = html;

  // Order matters: process display math ($$, \[) before inline ($, \()
  // to avoid partial matches.

  // 1. $$ ... $$ (display math) — must come before single $
  result = result.replace(
    /\$\$([\s\S]+?)\$\$/g,
    (_, tex: string) => renderKatex(tex.trim(), true),
  );

  // 2. \[ ... \] (MathJax display math)
  result = result.replace(
    /\\\[([\s\S]+?)\\\]/g,
    (_, tex: string) => renderKatex(tex.trim(), true),
  );

  // 3. \begin{...} ... \end{...} (LaTeX environments, display)
  result = result.replace(
    /(\\begin\{[^}]+\}[\s\S]+?\\end\{[^}]+\})/g,
    (match: string) => renderKatex(match.trim(), true),
  );

  // 4. \( ... \) (MathJax inline math)
  result = result.replace(
    /\\\(([\s\S]+?)\\\)/g,
    (_, tex: string) => renderKatex(tex.trim(), false),
  );

  // 5. $ ... $ (inline math) — avoid matching $$ (already handled).
  //    We use a callback to skip currency patterns ($5, $10) and
  //    avoid lookbehinds which older iOS WebViews don't support.
  result = result.replace(
    /\$([^$]+?)\$/g,
    (match: string, tex: string) => {
      // Skip currency patterns (just digits/punctuation)
      if (/^\d[\d,.]*$/.test(tex.trim())) return match;
      return renderKatex(tex.trim(), false);
    },
  );

  return result;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Quick check whether the HTML likely contains math notation.
 * Avoids running expensive regexes on cards with no math.
 *
 * @param html - Card HTML.
 * @returns True if any math delimiter pattern is detected.
 */
function containsMath(html: string): boolean {
  return (
    html.includes('\\(') ||
    html.includes('\\[') ||
    html.includes('$$') ||
    html.includes('\\begin{') ||
    // Single $ — only if it appears at least twice (opening + closing)
    (html.indexOf('$') !== -1 && html.indexOf('$', html.indexOf('$') + 1) !== -1)
  );
}

/**
 * Render a single LaTeX expression to HTML via KaTeX.
 * On failure, returns the raw LaTeX in a styled code element.
 *
 * @param tex         - Raw LaTeX string (without delimiters).
 * @param displayMode - True for display (block) math, false for inline.
 * @returns Rendered HTML string.
 */
function renderKatex(tex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(tex, {
      displayMode,
      throwOnError: false,
      strict: false,
      trust: true,
      output: 'htmlAndMathml',
    });
  } catch {
    // Show raw LaTeX rather than nothing
    const escaped = tex
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    const tag = displayMode ? 'div' : 'span';
    return `<${tag} class="katex-error" style="color:#c084fc;font-family:monospace;font-size:0.9em">${escaped}</${tag}>`;
  }
}
