import { describe, expect, it } from 'vitest';
import { renderLegacyCardHints } from './cardHints';

function legacy(field: string, clue: string) {
  return `<a class="hint" onclick="this.style.display='none';document.getElementById('hint_${field}').style.display='';return false;" href="#">Show Hint</a><span id="hint_${field}" style="display:none">${clue}</span>`;
}
const disclosure = (clue: string) => `<details class="hint"><summary>Show Hint</summary><span>${clue}</span></details>`;

describe('saved legacy hint display', () => {
  it('keeps nested rich content intact while removing the generated handler from display', () => {
    const clue = '<b>First <span data-detail="a > b">nested <i>clue</i></span></b><img src="clue.png">[sound:clue.mp3]';
    const original = `<p>Question</p>${legacy('Clue', clue)}<p>After</p>`;
    expect(renderLegacyCardHints(original)).toBe(`<p>Question</p>${disclosure(clue)}<p>After</p>`);
    expect(original).toContain('onclick=');
    expect(original).toContain('style="display:none"');
  });

  it('handles independent, repeated-name and nested hints without duplicate DOM IDs', () => {
    const original = legacy('One', `Outer ${legacy('Two', '<b>Inner</b>')} after`) + legacy('One', 'Another');
    const rendered = renderLegacyCardHints(original);
    expect(rendered).toBe(disclosure(`Outer ${disclosure('<b>Inner</b>')} after`) + disclosure('Another'));
    expect(rendered).not.toMatch(/onclick|id="hint_/);
  });

  it('ignores span-like text inside comments, raw-text elements and quoted attributes', () => {
    const clue = '<!-- <span> ignored --><style>.x::before{content:"<span>"}</style><span data-example="<span>">Actual</span>';
    expect(renderLegacyCardHints(legacy('Clue', clue))).toBe(disclosure(clue));
    const source = `<script>const sample = '${legacy('Script', 'Do not transform script source')}';</script>`;
    expect(renderLegacyCardHints(source)).toBe(source);
  });

  it('does not convert arbitrary imported handlers, mismatched targets or malformed markup', () => {
    const custom = '<a class="hint" onclick="customHint()" href="#">Hint</a><span style="display:none">Hidden</span>';
    expect(renderLegacyCardHints(custom)).toBe(custom);
    const mismatched = legacy('Clue', 'Hidden').replace('id="hint_Clue"', 'id="hint_Other"');
    expect(renderLegacyCardHints(mismatched)).toBe(mismatched);
    const unfinished = legacy('Clue', 'Hidden').replace('</span>', '');
    expect(renderLegacyCardHints(unfinished)).toBe(unfinished);
  });

  it('is idempotent and leaves modern details and ordinary content unchanged', () => {
    const modern = `<p>Question</p>${disclosure('<i>A clue</i>')}`;
    expect(renderLegacyCardHints(modern)).toBe(modern);
    const converted = renderLegacyCardHints(legacy('Clue', 'A clue'));
    expect(renderLegacyCardHints(converted)).toBe(converted);
    expect(renderLegacyCardHints('')).toBe('');
  });
});
