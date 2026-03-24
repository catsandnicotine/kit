/**
 * PixelCat — 8-bit stray cat mascot, minimal black and white.
 *
 * Fully inlined SVG (no external assets) so it renders reliably on iOS
 * Capacitor. Uses theme context for fill color since Tailwind dark: can
 * be unreliable in native WebViews.
 */

import { useTheme } from '../hooks/useTheme';

interface PixelCatProps {
  /** Height in pixels (width scales proportionally). Default 64. */
  size?: number;
  /** Additional CSS classes. */
  className?: string;
}

/**
 * 8-bit pixel art stray cat. Inlined SVG — no file references.
 *
 * @param size      - Width/height in pixels (square).
 * @param className - Additional CSS classes.
 */
// 12x6 pixel grid — cat head only (ears, eyes, nose).
const GRID = [
  [0,0,1,0,0,0,0,0,1,0,0,0],
  [0,1,1,1,0,0,0,1,1,1,0,0],
  [0,1,1,1,1,1,1,1,1,1,0,0],
  [0,1,0,1,1,1,1,0,1,1,0,0],
  [0,1,1,1,0,1,1,1,1,1,0,0],
  [0,0,1,1,1,1,1,1,1,0,0,0],
];
const COLS = 12;
const ROWS = 6;

export function PixelCat({ size = 64, className = '' }: PixelCatProps) {
  const { resolvedTheme } = useTheme();
  const fill = resolvedTheme === 'dark' ? '#E5E5E5' : '#1c1c1e';

  const cellSize = size / ROWS;
  const width = COLS * cellSize;

  return (
    <svg
      width={width}
      height={size}
      viewBox={`0 0 ${width} ${size}`}
      className={className}
      aria-label="Kit the cat"
      role="img"
    >
      {GRID.map((row, y) =>
        row.map((cell, x) =>
          cell ? (
            <rect
              key={`${x}-${y}`}
              x={x * cellSize}
              y={y * cellSize}
              width={cellSize}
              height={cellSize}
              fill={fill}
            />
          ) : null,
        ),
      )}
    </svg>
  );
}
