import { describe, expect, it } from 'vitest';
import { getMediaReferences, rewriteMediaUrls } from './media';

describe('Anki media references', () => {
  it('resolves URL-encoded and HTML-escaped filenames while preserving external links', () => {
    const urls = new Map([['a & b #1.png','blob:picture'],['image space.png','blob:space']]);
    expect(rewriteMediaUrls('<img src="a &amp; b #1.png"><img src="image%20space.png"><img src="https://example.com/a.png">', urls))
      .toBe('<img src="blob:picture"><img src="blob:space"><img src="https://example.com/a.png">');
  });
  it('finds images, SVG bases/masks, CSS resources and audio for per-deck routing', () => {
    const html = `<img src="image%20space.png"><svg><image xlink:href='mask.svg'></image></svg><style>@font-face{src:url("font.woff2")}</style>[sound:voice.mp3]<a href="https://example.com">Link</a>`;
    expect([...getMediaReferences(html)].sort()).toEqual(['font.woff2','image space.png','mask.svg','voice.mp3']);
  });
  it('keeps narrow no-break spaces in original macOS screenshot filenames', () => {
    const name = 'Screenshot at 5.22.02\u202fPM.png';
    expect(rewriteMediaUrls(`<img src="${name}">`,new Map([[name,'blob:picture']]))).toBe('<img src="blob:picture">');
  });
});
