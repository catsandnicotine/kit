import { describe, expect, it } from 'vitest';
import { compilePixelDrawing } from './compilePixelDrawing';
import { RATING_ART } from '../components/art/ratingArt';
import { EYE_GRID, EYE_PALETTE } from '../components/art/eyeArt';
import type { PixelBoundaryPoint } from '../types/pixelArtCompilation';

function readFills(paths: readonly string[]): Map<string, number> {
  const pixels = new Map<string, number>();
  paths.forEach((path, shade) => {
    for (const match of path.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+Z/g)) {
      const start = Number(match[1]);
      const y = Number(match[2]);
      const length = Number(match[3]);
      for (let x = start; x < start + length; x++) {
        const key = `${x},${y}`;
        expect(pixels.has(key)).toBe(false);
        pixels.set(key, shade + 1);
      }
    }
  });
  return pixels;
}

function readLoops(outline: string): PixelBoundaryPoint[][] {
  return outline.split('Z').filter(Boolean).map(loop =>
    Array.from(loop.matchAll(/[ML](\d+) (\d+)/g), match => ({ x:Number(match[1]), y:Number(match[2]) })));
}

function signedArea(points: readonly PixelBoundaryPoint[]): number {
  return points.reduce((area, point, index) => {
    const next = points[(index + 1) % points.length]!;
    return area + point.x * next.y - next.x * point.y;
  }, 0) / 2;
}

function outlineEdges(outline: string): Set<string> {
  const edges = new Set<string>();
  for (const loop of readLoops(outline)) {
    loop.forEach((point, index) => {
      const next = loop[(index + 1) % loop.length]!;
      if (point.x === next.x) {
        for (let y = Math.min(point.y, next.y); y < Math.max(point.y, next.y); y++) {
          const edge = `v:${point.x},${y}`;
          expect(edges.has(edge)).toBe(false);
          edges.add(edge);
        }
      } else {
        expect(point.y).toBe(next.y);
        for (let x = Math.min(point.x, next.x); x < Math.max(point.x, next.x); x++) {
          const edge = `h:${x},${point.y}`;
          expect(edges.has(edge)).toBe(false);
          edges.add(edge);
        }
      }
    });
  }
  return edges;
}

describe('pixel drawing compilation', () => {
  it('preserves different colour pixels while omitting their shared interior edges', () => {
    const drawing = compilePixelDrawing(['12', '21'], 2);
    expect(readFills(drawing.paths)).toEqual(new Map([['0,0', 1], ['1,0', 2], ['0,1', 2], ['1,1', 1]]));
    expect(drawing.outline).toBe('M0 0L2 0L2 2L0 2Z');
    const edges = outlineEdges(drawing.outline);
    expect(edges.size).toBe(8);
    expect(edges.has('v:1,0')).toBe(false);
    expect(edges.has('h:0,1')).toBe(false);
  });

  it('retains a hole as a separate boundary with opposite winding', () => {
    const drawing = compilePixelDrawing(['111', '1.1', '111'], 1);
    const loops = readLoops(drawing.outline);
    expect(loops).toHaveLength(2);
    expect(loops.map(signedArea).sort((a, b) => a - b)).toEqual([-1, 9]);
    expect(outlineEdges(drawing.outline).size).toBe(16);
    expect(readFills(drawing.paths).has('1,1')).toBe(false);
  });

  it('keeps diagonal and separated pixels as independent closed contours', () => {
    for (const grid of [['1.', '.2'], ['1.2']]) {
      const drawing = compilePixelDrawing(grid, 2);
      const loops = readLoops(drawing.outline);
      expect(loops).toHaveLength(2);
      expect(loops.map(signedArea)).toEqual([1, 1]);
      expect(outlineEdges(drawing.outline).size).toBe(8);
    }
  });

  it('handles empty transparent art and rejects unavailable palette entries', () => {
    expect(compilePixelDrawing(['...', '...'], 2)).toEqual({ paths:['', ''], outline:'' });
    expect(() => compilePixelDrawing(['2'], 1)).toThrow('unavailable palette shade');
  });

  it('preserves every production eye and recall-frame pixel with exactly its exposed edges', () => {
    const artworks = [{ grid:EYE_GRID, shades:EYE_PALETTE.length },
      ...Object.values(RATING_ART).flatMap(art => [art.rest, ...art.frames.map(frame => frame.grid)]
        .map(grid => ({ grid, shades:art.palette.length })))];
    for (const { grid, shades } of artworks) {
      const drawing = compilePixelDrawing(grid, shades);
      const expectedPixels = new Map<string, number>();
      grid.forEach((row, y) => Array.from(row).forEach((shade, x) => {
        if (shade !== '.') expectedPixels.set(`${x},${y}`, Number(shade));
      }));
      expect(readFills(drawing.paths)).toEqual(expectedPixels);
      const expectedEdges = new Set<string>();
      for (const point of expectedPixels.keys()) {
        const [x, y] = point.split(',').map(Number) as [number, number];
        if (!expectedPixels.has(`${x},${y - 1}`)) expectedEdges.add(`h:${x},${y}`);
        if (!expectedPixels.has(`${x},${y + 1}`)) expectedEdges.add(`h:${x},${y + 1}`);
        if (!expectedPixels.has(`${x - 1},${y}`)) expectedEdges.add(`v:${x},${y}`);
        if (!expectedPixels.has(`${x + 1},${y}`)) expectedEdges.add(`v:${x + 1},${y}`);
      }
      expect(outlineEdges(drawing.outline)).toEqual(expectedEdges);
      expect(drawing.paths).toHaveLength(shades);
    }
  });
});
