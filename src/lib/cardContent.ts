/**
 * Determine whether rich card HTML contains something a learner can perceive.
 *
 * @param html - Rich HTML from the card editor.
 * @returns True for visible text, images, SVG/math, or Anki sound references.
 */
export function hasMeaningfulCardContent(html: string): boolean {
  if (/\[sound:[^\]]+\]/i.test(html)) return true;
  if (/<(?:img|svg|math|audio|video)\b/i.test(html)) return true;

  const text = html
    .replace(/<br\s*\/?\s*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(?:nbsp|#160);/gi, ' ')
    .replace(/&(?:lt|gt|amp|quot|apos);/gi, 'x')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 0;
}
