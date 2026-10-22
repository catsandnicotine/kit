import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TabBar } from './TabBar';

describe('library page marker lifecycle', () => {
  it.each(['learn', 'review'] as const)('leaves only the two anchors when %s settles', mode => {
    const html = renderToStaticMarkup(<TabBar mode={mode} onChange={() => undefined} />);
    expect(html).not.toContain('library-page-traveller');
    expect(html.match(/<button /g)).toHaveLength(2);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  });

  it('keeps the single moving pixel through the drag and return, then removes it', () => {
    const props = { mode: 'learn' as const, onChange: () => undefined };
    const drag = renderToStaticMarkup(<TabBar {...props} pageProgress={0.5} />);
    const returning = renderToStaticMarkup(<TabBar {...props} pageProgress={0} returning />);
    const settled = renderToStaticMarkup(<TabBar {...props} pageProgress={0} />);
    expect(drag.match(/class="library-page-traveller"/g)).toHaveLength(1);
    expect(returning.match(/class="library-page-traveller"/g)).toHaveLength(1);
    expect(settled).not.toContain('library-page-traveller');
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 2])('cannot leave a stray pixel for an invalid or outer position %s', pageProgress => {
    const html = renderToStaticMarkup(<TabBar mode="review" onChange={() => undefined} pageProgress={pageProgress} />);
    expect(html).not.toContain('library-page-traveller');
  });
});
