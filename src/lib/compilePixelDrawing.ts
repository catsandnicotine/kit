import type { CompiledPixelDrawing, PixelBoundaryEdge, PixelBoundaryPoint } from '../types/pixelArtCompilation';

const key = ({ x, y }: PixelBoundaryPoint) => `${x},${y}`;
const TURN_ORDER = [1, 0, 3, 2];

function boundaryPath(edges: readonly PixelBoundaryEdge[]): string {
  const outgoing = new Map<string, number[]>();
  edges.forEach((edge, index) => {
    const start = key(edge.from);
    const indices = outgoing.get(start);
    if (indices) indices.push(index);
    else outgoing.set(start, [index]);
  });
  const visited = new Uint8Array(edges.length);
  let path = '';
  for (let first = 0; first < edges.length; first++) {
    if (visited[first]) continue;
    const origin = edges[first]!.from;
    const points: PixelBoundaryPoint[] = [origin];
    let current = first;
    while (!visited[current]) {
      const edge = edges[current]!;
      visited[current] = 1;
      if (edge.to.x === origin.x && edge.to.y === origin.y) break;
      points.push(edge.to);
      let next: number | undefined;
      let bestTurn = Infinity;
      for (const candidate of outgoing.get(key(edge.to)) ?? []) {
        if (visited[candidate]) continue;
        const turn = (edges[candidate]!.direction - edge.direction + 4) % 4;
        const rank = TURN_ORDER.indexOf(turn);
        if (rank < bestTurn) { bestTurn = rank; next = candidate; }
      }
      if (next === undefined) throw new Error('Pixel drawing has an open boundary.');
      current = next;
    }
    // Keep corners only; long sides need one line rather than one edge per pixel.
    const corners = points.filter((point, index) => {
      const previous = points[(index + points.length - 1) % points.length]!;
      const next = points[(index + 1) % points.length]!;
      const dx = point.x - previous.x;
      const dy = point.y - previous.y;
      const nextDx = next.x - point.x;
      const nextDy = next.y - point.y;
      return dx * nextDy !== dy * nextDx || dx * nextDx + dy * nextDy <= 0;
    });
    path += corners.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x} ${point.y}`).join('') + 'Z';
  }
  return path;
}

/** Compile unchanged colour pixels and only their exposed silhouette boundaries.
 * @param grid - Rows containing transparent dots or one-based palette digits.
 * @param shadeCount - Number of colours available in the drawing's palette.
 * @returns One fill path per shade and a closed, unfilled contour without interior edges.
 */
export function compilePixelDrawing(grid: readonly string[], shadeCount: number): CompiledPixelDrawing {
  const paths = Array.from({ length: shadeCount }, () => '');
  const edges: PixelBoundaryEdge[] = [];
  const occupied = (x: number, y: number) => {
    const shade = grid[y]?.[x];
    return shade !== undefined && shade !== '.';
  };
  grid.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const shade = row[x]!;
      if (shade === '.') { x++; continue; }
      const shadeIndex = Number(shade) - 1;
      if (!Number.isInteger(shadeIndex) || shadeIndex < 0 || shadeIndex >= shadeCount) {
        throw new Error('Pixel drawing references an unavailable palette shade.');
      }
      const start = x;
      while (x < row.length && row[x] === shade) x++;
      const length = x - start;
      paths[shadeIndex] += `M${start} ${y}h${length}v1h-${length}Z`;
      for (let column = start; column < x; column++) {
        if (!occupied(column, y - 1)) edges.push({ from:{ x:column, y }, to:{ x:column + 1, y }, direction:0 });
        if (!occupied(column + 1, y)) edges.push({ from:{ x:column + 1, y }, to:{ x:column + 1, y:y + 1 }, direction:1 });
        if (!occupied(column, y + 1)) edges.push({ from:{ x:column + 1, y:y + 1 }, to:{ x:column, y:y + 1 }, direction:2 });
        if (!occupied(column - 1, y)) edges.push({ from:{ x:column, y:y + 1 }, to:{ x:column, y }, direction:3 });
      }
    }
  });
  return { paths, outline:boundaryPath(edges) };
}
