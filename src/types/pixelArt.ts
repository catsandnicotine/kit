/** One separately drawn pixel pose and its exposure time. */
export interface PixelSpriteFrame {
  duration: number;
  grid: readonly string[];
}

/** Shared palette, resting silhouette, and authored feedback poses. */
export interface RatingSpriteArt {
  palette: readonly string[];
  width: number;
  rest: readonly string[];
  frames: readonly PixelSpriteFrame[];
}

/** Original eye directions available in the art study; the app uses Aureole. */
export type EyeVariant = 'current' | 'lapis' | 'vesper' | 'aureole';

/** Authored platinum light arrangements around the Aureole eye. */
export type EyeHalo = 'oval' | 'rays' | 'beads' | 'arc';
