/** Cached SVG geometry for an authored pixel drawing. */
export interface CompiledPixelDrawing {
  paths: readonly string[];
  outline: string;
}

/** Integer corner of an occupied pixel. */
export interface PixelBoundaryPoint {
  x: number;
  y: number;
}

/** Clockwise edge with an occupied pixel on its right. */
export interface PixelBoundaryEdge {
  from: PixelBoundaryPoint;
  to: PixelBoundaryPoint;
  direction: number;
}
