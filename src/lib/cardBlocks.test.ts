import { describe, expect, it } from 'vitest';
import { getCardBlockDropAnchor, moveCardBlock, serializeCardBlocks } from './cardBlocks';
import type { CardContentBlock, CardSideContent } from '../types/cardBlocks';

const blocks: CardContentBlock[] = [
  { id: 'a', kind: 'text', html: '<b>A question</b>' },
  { id: 'b', kind: 'image', html: '<img src="original.jpg" alt="Diagram">' },
  { id: 'c', kind: 'text', html: 'Its caption' },
];

describe('ordered card content', () => {
  it('retains video files and controls while moving them between text and photos', () => {
    const video: CardContentBlock = { id:'v', kind:'video', html:'<video src="clip.mov" poster="cover.jpg" controls playsinline><track src="captions.vtt"></video>' };
    const next = moveCardBlock([...blocks, video], 'v', 1);
    expect(next.map(block => block.id)).toEqual(['a','v','b','c']);
    expect(serializeCardBlocks(next)).toBe('<div><b>A question</b></div>' + video.html + '<img src="original.jpg" alt="Diagram"><div>Its caption</div>');
    expect(video.html).toContain('src="clip.mov"');
  });
  it('moves a photo across text without changing either content or the source array', () => {
    const reordered = moveCardBlock(blocks, 'b', 0);
    expect(reordered.map(block => block.id)).toEqual(['b', 'a', 'c']);
    expect(reordered[0]).toBe(blocks[1]);
    expect(blocks.map(block => block.id)).toEqual(['a', 'b', 'c']);
    expect(serializeCardBlocks(reordered)).toBe('<img src="original.jpg" alt="Diagram"><div><b>A question</b></div><div>Its caption</div>');
  });
  it('bounds moves and preserves the complete section set', () => {
    expect(moveCardBlock(blocks, 'a', 100).map(block => block.id)).toEqual(['b', 'c', 'a']);
    expect(moveCardBlock(blocks, 'c', -2).map(block => block.id)).toEqual(['c', 'a', 'b']);
    expect(moveCardBlock(blocks, 'missing', 0)).toEqual(blocks);
    expect(moveCardBlock(blocks, 'a', NaN)).toEqual(blocks);
  });
});


describe('preserved card styling', () => {
  it('keeps imported CSS separate when content is replaced, reordered, or removed', () => {
    const side: CardSideContent = { metadata: '<style>.card img{max-width:100%}</style><style>.card{color:teal}</style>', blocks: [...blocks] };
    const moved = moveCardBlock(side.blocks, 'b', 0);
    expect(serializeCardBlocks(moved, side.metadata)).toBe(`${side.metadata}<img src="original.jpg" alt="Diagram"><div><b>A question</b></div><div>Its caption</div>`);
    expect(serializeCardBlocks([], side.metadata)).toBe(side.metadata);
    expect(serializeCardBlocks([{ id: 'new-photo', kind: 'image', html: '<img src="new.jpg">' }], side.metadata)).toBe(`${side.metadata}<img src="new.jpg">`);
    expect(side.metadata).toBe('<style>.card img{max-width:100%}</style><style>.card{color:teal}</style>');
  });
});

describe('drag insertion position', () => {
  it('uses the same destination as a downward move and exposes the final end slot', () => {
    expect(getCardBlockDropAnchor(blocks, 'a', 1)).toBe('c');
    expect(moveCardBlock(blocks, 'a', 1).map(block => block.id)).toEqual(['b', 'a', 'c']);
    expect(getCardBlockDropAnchor(blocks, 'a', 2)).toBeNull();
    expect(moveCardBlock(blocks, 'a', 2).map(block => block.id)).toEqual(['b', 'c', 'a']);
  });
  it('also anchors upward moves before the intended non-dragged section', () => {
    expect(getCardBlockDropAnchor(blocks, 'c', 0)).toBe('a');
    expect(getCardBlockDropAnchor(blocks, 'b', 0)).toBe('a');
  });
});
