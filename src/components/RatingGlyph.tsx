import type { Rating } from '../types';
import { RATING_ART } from './art/ratingArt';
import { compilePixelDrawing } from '../lib/compilePixelDrawing';

// Compile artwork once. Playing a pose changes paths, never sprite transforms.
const DRAWINGS = Object.fromEntries(Object.entries(RATING_ART).map(([rating, art]) => {
  let elapsed = 0;
  const rest = compilePixelDrawing(art.rest, art.palette.length);
  return [rating, {
    rest: rest.paths,
    outline: rest.outline,
    frames: art.frames.map(frame => {
      const delay = elapsed;
      elapsed += frame.duration;
      return { ...compilePixelDrawing(frame.grid, art.palette.length), delay, duration: frame.duration };
    }),
  }] as const;
}));

/**
 * Draw a recall symbol with discrete pixel poses and material-specific light.
 * @param props.rating - The recall action represented by the symbol.
 * @returns Decorative sprite frames; the button supplies the accessible name.
 */
export function RatingGlyph({ rating }: { rating: Rating }) {
  const art = RATING_ART[rating];
  const drawings = DRAWINGS[rating]!;
  const height = art.rest.length;
  const paint = (paths: readonly string[]) => paths.map((path, index) => path
    ? <path key={index} d={path} fill={`var(--rating-shade-${index + 1}, ${art.palette[index]})`} /> : null);
  return <svg className={`rating-glyph rating-glyph--${rating}`} width={64 * art.width / height} height="64" viewBox={`0 0 ${art.width} ${height}`} shapeRendering="crispEdges" aria-hidden="true" focusable="false">
    <g className="rating-glyph-rest"><path className="pixel-art-contour" d={drawings.outline} />{paint(drawings.rest)}</g>
    {drawings.frames.map((frame, index) => <g key={index} className="rating-glyph-frame" style={{ animationDelay: `calc(${frame.delay}ms * var(--sprite-playback, 1))`, animationDuration: `calc(${frame.duration}ms * var(--sprite-playback, 1))` }}>
      <path className="pixel-art-contour" d={frame.outline} />{paint(frame.paths)}
    </g>)}
  </svg>;
}
