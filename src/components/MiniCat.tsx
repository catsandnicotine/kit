/**
 * MiniCat — cute pixel cat for deck progress bars.
 *
 * Three states based on progress:
 *  - progress=0 → sitting idle
 *  - 0 < progress < 1 → walking (2-frame CSS animation with alternating legs)
 *  - progress=1 → sitting happy (tail up)
 *
 * Uses a 12x8 pixel grid for more detail than the previous 8x5 version.
 */

import { useTheme } from '../hooks/useTheme';

interface MiniCatProps {
  /** Study progress 0–1. */
  progress: number;
  /** Height in pixels. Default 12. */
  size?: number;
}

/**
 * Cute pixel cat for progress bars.
 *
 * @param progress - Deck study progress 0–1.
 * @param size     - Height in pixels.
 */
export function MiniCat({ progress, size = 12 }: MiniCatProps) {
  const { resolvedTheme } = useTheme();
  const fill = resolvedTheme === 'dark' ? '#E5E5E5' : '#171717';

  const isWalking = progress > 0 && progress < 1;
  const isComplete = progress >= 1;

  // 12x8 grids — more pixels for a recognizable cat
  // Idle: sitting cat, legs tucked, tail curled
  const idle = [
    [0,0,1,0,0,0,0,0,0,1,0,0],
    [0,1,1,1,0,0,0,0,1,1,1,0],
    [0,1,1,1,1,1,1,1,1,1,1,0],
    [0,1,0,1,1,1,1,1,0,1,1,0],
    [0,1,1,1,1,0,1,1,1,1,1,0],
    [0,0,1,1,1,1,1,1,1,1,0,0],
    [0,0,1,1,0,0,0,0,1,1,0,0],
    [0,0,1,1,0,0,0,0,1,1,0,0],
  ];

  // Walk frame 1: left legs forward
  const walk1 = [
    [0,0,1,0,0,0,0,0,0,1,0,0],
    [0,1,1,1,0,0,0,0,1,1,1,0],
    [0,1,1,1,1,1,1,1,1,1,1,0],
    [0,1,0,1,1,1,1,1,0,1,1,0],
    [0,1,1,1,1,0,1,1,1,1,0,0],
    [0,0,1,1,1,1,1,1,1,0,0,0],
    [0,1,0,1,0,0,0,1,0,0,0,0],
    [1,0,0,0,1,0,0,0,1,0,0,0],
  ];

  // Walk frame 2: right legs forward
  const walk2 = [
    [0,0,1,0,0,0,0,0,0,1,0,0],
    [0,1,1,1,0,0,0,0,1,1,1,0],
    [0,1,1,1,1,1,1,1,1,1,1,0],
    [0,1,0,1,1,1,1,1,0,1,1,0],
    [0,0,1,1,1,0,1,1,1,1,0,0],
    [0,0,0,1,1,1,1,1,1,0,0,0],
    [0,0,0,0,1,0,0,1,0,1,0,0],
    [0,0,0,1,0,0,0,0,1,0,1,0],
  ];

  // Happy: tail up, content pose
  const happy = [
    [0,0,1,0,0,0,0,0,0,1,0,0],
    [0,1,1,1,0,0,0,0,1,1,1,0],
    [0,1,1,1,1,1,1,1,1,1,1,0],
    [0,1,0,1,1,1,1,1,0,1,1,0],
    [0,1,1,1,1,0,1,1,1,1,0,1],
    [0,0,1,1,1,1,1,1,1,0,0,1],
    [0,0,1,1,0,0,0,0,1,1,0,0],
    [0,0,1,1,0,0,0,0,1,1,0,0],
  ];

  const cols = 12;
  const rows = 8;
  const cellSize = size / rows;
  const width = cols * cellSize;

  if (isWalking) {
    // Two-frame animation via CSS: show frame 1, hide frame 2, alternate
    return (
      <div className="minicat-walking" style={{ width, height: size, position: 'relative' }}>
        <svg
          width={width}
          height={size}
          viewBox={`0 0 ${width} ${size}`}
          className="minicat-frame1"
          aria-hidden="true"
          style={{ position: 'absolute', top: 0, left: 0 }}
        >
          {walk1.map((row, y) =>
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
        <svg
          width={width}
          height={size}
          viewBox={`0 0 ${width} ${size}`}
          className="minicat-frame2"
          aria-hidden="true"
          style={{ position: 'absolute', top: 0, left: 0 }}
        >
          {walk2.map((row, y) =>
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
      </div>
    );
  }

  const grid = isComplete ? happy : idle;

  return (
    <svg
      width={width}
      height={size}
      viewBox={`0 0 ${width} ${size}`}
      aria-hidden="true"
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
