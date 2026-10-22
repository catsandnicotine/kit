import { describe, expect, it } from 'vitest';
import { moveCardEdge } from './cardEdgeFeedback';
import type { CardEdgeDrag } from '../types/cardScroll';

const initial: CardEdgeDrag = { x:0, y:0, previousY:0, axis:'pending', offset:0 };
const bounds = { top:0, height:400, contentHeight:1000 };

describe('card edge feedback', () => {
  it('leaves real content scrolling alone until it reaches an edge', () => {
    let state = moveCardEdge(initial, 0, -30, { ...bounds, top:200 });
    expect(state.offset).toBe(0);
    state = moveCardEdge(state, 0, -60, { ...bounds, top:600 });
    expect(state.offset).toBe(-6);
    state = moveCardEdge(state, 0, -80, { ...bounds, top:590 });
    expect(state.offset).toBe(0);
  });

  it('resists both ends and bounds even an extreme pull', () => {
    for (const direction of [-1, 1]) {
      let state = initial;
      const metrics = { ...bounds, top:direction < 0 ? 600 : 0 };
      for (let distance = 20; distance < 10000; distance += 20) state = moveCardEdge(state, 0, direction * distance, metrics);
      expect(Math.abs(state.offset)).toBeLessThanOrEqual(20);
      expect(Math.abs(state.offset)).toBeGreaterThan(19);
      expect(Math.sign(state.offset)).toBe(direction);
    }
  });

  it('reverses promptly without storing a huge invisible pull distance', () => {
    const pulled = moveCardEdge(initial, 0, 2000, bounds);
    expect(pulled.offset).toBe(20);
    const reversed = moveCardEdge(pulled, 0, 1970, bounds);
    expect(reversed.offset).toBe(8);
    expect(moveCardEdge(reversed, 0, 1940, bounds).offset).toBe(0);
  });

  it('decides an axis once and never steals a horizontal card turn', () => {
    const horizontal = moveCardEdge(initial, 20, 0, bounds);
    expect(moveCardEdge(horizontal, 20, 200, bounds)).toMatchObject({ axis:'horizontal', offset:0 });
    const vertical = moveCardEdge(initial, 1, 20, bounds);
    expect(moveCardEdge(vertical, 200, 40, bounds).axis).toBe('vertical');
    expect(moveCardEdge(initial, 1, 2, bounds).offset).toBe(0);
  });

  it('uses the same small give on short cards and a smaller cap in short viewports', () => {
    expect(moveCardEdge(initial, 0, 10000, { top:0, height:200, contentHeight:100 }).offset).toBe(12);
    expect(moveCardEdge(initial, 0, -10000, { top:0, height:200, contentHeight:100 }).offset).toBe(-12);
    expect(moveCardEdge(initial, 0, 10000, { ...bounds, height:0 }).offset).toBe(0);
  });

  it('drops unavailable geometry without producing an invalid transform', () => {
    expect(moveCardEdge(initial, 0, Infinity, bounds).offset).toBe(0);
    expect(moveCardEdge(initial, 0, 50, { ...bounds, top:NaN }).offset).toBe(0);
  });
});
