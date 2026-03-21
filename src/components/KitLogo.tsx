/**
 * KitLogo — inline SVG pixel-grid rendering "Ki†".
 *
 * The "t" is a cross (†) — same height/stroke as K and i.
 * Uses useTheme() for fill color.
 */

import { useTheme } from '../hooks/useTheme';

interface KitLogoProps {
  /** Height in pixels. Width scales proportionally. Default 16. */
  height?: number;
}

/**
 * Pixel-art "Ki†" logo rendered as inline SVG.
 *
 * @param height - Logo height in pixels.
 */
export function KitLogo({ height = 16 }: KitLogoProps) {
  const { resolvedTheme } = useTheme();
  const fill = resolvedTheme === 'dark' ? '#E5E5E5' : '#171717';

  // 5-row grid for each letter, 1px gap between letters.
  // K: 3 wide, i: 1 wide, †: 3 wide → total 10 cols with gaps
  // Using a 12x5 grid for clean pixel rendering.
  //
  // K        i   †
  // 1 0 1    1   0 1 0
  // 1 1 0    0   1 1 1
  // 1 0 0    1   0 1 0
  // 1 1 0    1   0 1 0
  // 1 0 1    1   0 1 0

  const grid = [
    [1,0,1, 0, 1, 0, 0,1,0],
    [1,1,0, 0, 0, 0, 1,1,1],
    [1,0,0, 0, 1, 0, 0,1,0],
    [1,1,0, 0, 1, 0, 0,1,0],
    [1,0,1, 0, 1, 0, 0,1,0],
  ];

  const cols = 9;
  const rows = 5;
  const cellSize = height / rows;
  const width = cols * cellSize;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-label="Kit logo"
      role="img"
    >
      {grid.map((row, y) =>
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
