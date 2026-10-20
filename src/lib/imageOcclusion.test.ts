import { describe, expect, it } from 'vitest';
import { renderImageOcclusion } from './imageOcclusion';

const diagram = '<div id="image-occlusion-container"><img src="diagram.png"><canvas id="image-occlusion-canvas"></canvas></div>'
  + '<div class="io-data" data-io-rects="image-occlusion:rect:left=0.1:top=0.2:width=0.3:height=0.4:oi=1"></div>'
  + '<script>anki.imageOcclusion.setup();</script><div><button id="toggle">Toggle Masks</button></div>';

describe('built-in Anki image occlusion', () => {
  it('covers the diagram target without leaving a broken Anki runtime control', () => {
    const front = renderImageOcclusion(diagram, 'front');
    expect(front).toContain('io-svg-overlay');
    expect(front).toContain('fill="#ff8e8e"');
    expect(front).not.toContain('<canvas');
    expect(front).not.toContain('<script');
    expect(front).not.toContain('Toggle Masks');
  });

  it('reveals the answer while retaining the target outline', () => {
    const back = renderImageOcclusion(diagram, 'back');
    expect(back).toContain('fill="none"');
    expect(back).toContain('stroke="#ff8e8e"');
    expect(renderImageOcclusion('<p>Ordinary card</p>', 'front')).toBe('<p>Ordinary card</p>');
  });
});
