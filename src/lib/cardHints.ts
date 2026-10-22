import type { CardHintBoundary, CardHintReplacement } from '../types/cardHints';

/** Render old Kit-generated hints without executing their saved inline handler.
 * @param html - Saved rendered HTML; its source string and stored card stay unchanged.
 * @returns Display-only native disclosures, preserving nested clue markup exactly.
 */
export function renderLegacyCardHints(html: string): string {
  if (!html.includes('class="hint" onclick="this.style.display=')) return html;
  // Tokenize tags as units so quoted attributes, comments and raw-text elements
  // cannot create false span boundaries. No DOM, scripts or network are used.
  const tags = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<(script|style|textarea|title|xmp)\b(?:[^>"']|"[^"]*"|'[^']*')*>[\s\S]*?<\/\1\s*>|<\/?[a-z][a-z0-9:-]*\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
  const spans: number[] = [];
  const closes = new Map<number, CardHintBoundary>();
  for (const token of html.matchAll(tags)) {
    if (/^<span\b/i.test(token[0])) spans.push(token.index + token[0].length);
    else if (/^<\/span\b/i.test(token[0])) {
      const openEnd = spans.pop();
      if (openEnd !== undefined) closes.set(openEnd, { start:token.index, end:token.index + token[0].length });
    }
  }
  const oldHint = /<a class="hint" onclick="this\.style\.display='none';document\.getElementById\('(hint_[^"]*)'\)\.style\.display='';return false;" href="#">Show Hint<\/a><span id="\1" style="display:none">/g;
  const edits: CardHintReplacement[] = [];
  for (const hint of html.matchAll(oldHint)) {
    const openEnd = hint.index + hint[0].length;
    const close = closes.get(openEnd);
    if (!close) continue;
    edits.push({ start:hint.index, end:openEnd, html:'<details class="hint"><summary>Show Hint</summary><span>' });
    edits.push({ ...close, html:'</span></details>' });
  }
  let result = html;
  for (const edit of edits.sort((a, b) => b.start - a.start)) result = result.slice(0, edit.start) + edit.html + result.slice(edit.end);
  return result;
}
