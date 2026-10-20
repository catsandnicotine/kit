import { KIT_CAT_GRID, KIT_CAT_PALETTE } from '../lib/kitCat';

interface PixelCatProps { size?: number; className?: string; }

/**
 * Draw the single Kit mascot in the shared shaded pixel style.
 * @param props - Display height and optional layout classes.
 * @returns Accessible inline pixel art with no external assets.
 */
export function PixelCat({ size = 64, className = '' }: PixelCatProps) {
  return <svg width={size * 28 / 30} height={size} viewBox="0 0 28 30" className={className} shapeRendering="crispEdges" aria-label="Kit the cat" role="img">
    {KIT_CAT_GRID.flatMap((row, y) => Array.from(row, (shade, x) => shade === '.' ? null :
      <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill={KIT_CAT_PALETTE[shade]} />))}
  </svg>;
}
