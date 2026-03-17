/**
 * PixelCat — 8-bit stray cat mascot, minimal black and white.
 *
 * A simple pixel-art cat rendered as an inline SVG using small rectangles
 * to simulate pixel art. Respects dark mode.
 */

interface PixelCatProps {
  /** Width/height in pixels. Default 64. */
  size?: number;
  /** Additional CSS classes. */
  className?: string;
}

/**
 * 8-bit pixel art stray cat.
 *
 * @param size      - Width/height in pixels (square).
 * @param className - Additional CSS classes.
 */
export function PixelCat({ size = 64, className = '' }: PixelCatProps) {
  // 12x12 pixel grid. 1 = filled, 0 = empty.
  // Cat sitting with pointy ears, small body, tail curling up.
  const grid = [
    [0,0,1,0,0,0,0,0,1,0,0,0],
    [0,1,1,1,0,0,0,1,1,1,0,0],
    [0,1,1,1,1,1,1,1,1,1,0,0],
    [0,1,0,1,1,1,1,0,1,1,0,0],
    [0,1,1,1,0,1,1,1,1,1,0,0],
    [0,0,1,1,1,1,1,1,1,0,0,0],
    [0,0,1,1,1,1,1,1,1,0,0,0],
    [0,0,1,1,1,1,1,1,1,0,0,0],
    [0,0,1,1,0,0,0,1,1,0,0,0],
    [0,0,1,1,0,0,0,1,1,1,0,0],
    [0,0,0,0,0,0,0,0,0,1,1,0],
    [0,0,0,0,0,0,0,0,0,0,1,0],
  ];

  const cellSize = size / 12;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={className}
      aria-label="Kit the cat"
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
              className="fill-[#171717] dark:fill-[#E5E5E5]"
            />
          ) : null,
        ),
      )}
    </svg>
  );
}
