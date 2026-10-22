import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CardScrollFrame } from './CardScrollFrame';

describe('card edge first paint', () => {
  it.each([true, false])('paints the fade before measurements with visible=%s', visible => {
    const html = renderToStaticMarkup(<CardScrollFrame contentKey="sample" visible={visible}><p>Sample card</p></CardScrollFrame>);
    expect(html).toContain('<div class="card-scroll-edge" aria-hidden="true">');
    expect(html).not.toMatch(/class="card-scroll-edge"[^>]*\bhidden(?:=""|\s|>)/);
    expect(html).toContain('Sample card');
    // Unmeasured content must not promise that something remains below.
    expect(html).not.toContain('<svg');
  });
});
