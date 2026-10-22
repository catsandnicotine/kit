import type { CSSProperties } from 'react';
import { EYE_HALO_MARKS, EYE_LIGHT_POSES } from './art/eyeIdleArt';
import { EYE_GRID, EYE_PALETTE } from './art/eyeArt';
import type { EyeHalo, EyeVariant } from '../types/pixelArt';
import { compilePixelDrawing } from '../lib/compilePixelDrawing';

const PALETTES = {
  current: EYE_PALETTE,
  lapis: ['#fff8df', '#e9e5cf', '#b6cbc9', '#70847b', '#243b47', '#8ad9ff', '#3b8ef0', '#234da2', '#111e39'],
  vesper: ['#fff6de', '#eddfc2', '#c1b596', '#8a7763', '#453e36', '#ffdb75', '#d99b37', '#925523', '#30251c'],
  aureole: ['#f7faf7', '#dce3df', '#afc6b8', '#728a79', '#2b453e', '#9bf2bd', '#44b88c', '#24645a', '#122e2d'],
  practice: ['#fcfaf4', '#e2e2df', '#bac1cd', '#7b8498', '#394353', '#bdcde4', '#748db7', '#42567c', '#1f2c48'],
} as const;
// A close, broken orbit rather than Study's outward light: a different silhouette,
// not a badge or an additional mode label.
const PRACTICE_ORBIT = 'M7 7h18v1H7ZM3 9h4v1H3ZM-1 12h3v1h-3ZM-4 17h1v5h-1ZM30 12h3v1h-3ZM35 17h1v5h-1ZM25 9h4v1h-4ZM7 31h18v1H7ZM3 29h4v1H3ZM-1 26h3v1h-3ZM30 26h3v1h-3ZM25 29h4v1h-4Z';
const RAYS = 'M15 1h2v4h-2ZM6 2h2v2h2v2h2v2h-2V6H8V4H6ZM24 2h2v2h-2v2h-2v2h-2V6h2V4h2ZM15 35h2v4h-2ZM10 32h2v2h-2v2H8v2H6v-2h2v-2h2ZM20 32h2v2h2v2h2v2h-2v-2h-2v-2h-2Z';
// Integer-grid marks leave air between the lid and the surrounding light.
const HALOS: Record<EyeHalo, string> = {
  oval: EYE_HALO_MARKS.map(mark => mark.path).join(''),
  rays: 'M15 4h2v3h-2ZM3 7h1v1h1v2H4V9H3ZM27 7h1v2h-1v1h-1V8h1ZM-4 19h3v1h-3ZM33 19h3v1h-3ZM4 30h1v2H4v1H3v-2h1ZM26 30h1v1h1v2h-1v-1h-1ZM15 34h2v3h-2Z',
  beads: 'M15 6h2v1h-2ZM6 8h1v1H6ZM25 8h1v1h-1ZM0 12h1v1H0ZM31 12h1v1h-1ZM-3 19h1v1h-1ZM34 19h1v1h-1ZM0 27h1v1H0ZM31 27h1v1h-1ZM6 31h1v1H6ZM25 31h1v1h-1ZM15 33h2v1h-2Z',
  arc: 'M11 6h10v1H11ZM5 8h4v1H5ZM23 8h4v1h-4ZM0 11h2v1H0ZM30 11h2v1h-2ZM-3 17h1v5h-1ZM34 17h1v5h-1ZM0 28h2v1H0ZM30 28h2v1h-2ZM5 31h4v1H5ZM23 31h4v1h-4ZM11 33h10v1H11Z',
};
const VESPER_GRID = [
  '................................',
  '................................',
  '................................',
  '................................',
  '................................',
  '................................',
  '................................',
  '..........444444444444..........',
  '.......5553338888888333555.......',
  '.....53332228611996782223335.....',
  '...533222228711999976822222335...',
  '..53322222287699996782222222335..',
  '...533222228679999778222222335...',
  '.....43322287799976822222334.....',
  '.......433388666688333334........',
  '..........444333333444...........',
  '.............444444.............',
  '................................',
  '................................',
  '................................',
  '................................',
  '................................',
  '................................',
  '................................',
] as const;

// Shared geometry is compiled once; variants change only the fill palette.
const EYE_DRAWING = compilePixelDrawing(EYE_GRID, EYE_PALETTE.length);
const VESPER_DRAWING = compilePixelDrawing(VESPER_GRID, PALETTES.vesper.length);

/** Render the current eye or an original direction for comparison.
 * @param props.variant - Original eye palette; Aureole has cool platinum light.
 * @param props.halo - Sparse oval marks, longer rays, points, or a broken arc.
 * @param props.idle - Enable restrained breathing and authored light poses.
 * @returns A decorative, shaded pixel eye; its containing control supplies meaning.
 */
export function EyeGlyph({ variant = 'current', halo = 'oval', idle = false }: { variant?: EyeVariant; halo?: EyeHalo; idle?: boolean }) {
  const palette = PALETTES[variant];
  const isPractice = variant === 'practice';
  const fullEye = variant === 'aureole' || isPractice;
  const drawing = variant === 'vesper' ? VESPER_DRAWING : EYE_DRAWING;
  const gold = variant === 'lapis' ? '#f4ca70' : '#eac878';
  return <svg className={`reveal-eye ${isPractice ? 'reveal-eye--aureole' : ''} reveal-eye--${variant} ${idle ? 'reveal-eye--idle' : ''}`} width={fullEye ? 184 : 96} height={fullEye ? 200 : 120} viewBox={fullEye ? '-7 -5 46 50' : '0 0 32 40'} shapeRendering="crispEdges" aria-hidden="true" focusable="false">
    {isPractice ? <path className={`reveal-halo reveal-halo--practice ${idle ? 'practice-orbit-breath' : ''}`} d={PRACTICE_ORBIT} /> : variant !== 'aureole'
      ? <path className={variant === 'current' ? 'reveal-rays' : undefined} fill={variant === 'current' ? undefined : `var(--eye-gold, ${gold})`} d={RAYS} />
      : idle && halo === 'oval' ? <g className="reveal-halo reveal-halo--oval eye-halo-breath">
          {EYE_HALO_MARKS.map((mark, index) => <g key={index} style={{ '--ray-x': `${mark.dx}px`, '--ray-y': `${mark.dy}px` } as CSSProperties} className="eye-halo-ray"><path d={mark.path} /></g>)}
        </g> : <path className={`reveal-halo reveal-halo--${halo}`} d={HALOS[halo]} />}
    <g className="eye-body" transform="translate(0 8)">
      <path className="pixel-art-contour" d={drawing.outline} />
      {drawing.paths.map((path, index) => path ? <path key={index} d={path} fill={palette[index]} /> : null)}
      {variant === 'lapis' && <path fill="#e4bc69" d="M12 5h9v1h-9ZM9 6h3v1H9ZM21 6h3v1h-3Z" />}
      {fullEye && <path className="reveal-eye-metal" d="M2 10h1v3H2ZM29 10h1v3h-1ZM13 18h6v1h-6Z" />}
      {idle && fullEye && <g className="eye-idle-light" fill={isPractice ? '#f1f4ff' : '#effff5'}>
        {EYE_LIGHT_POSES.map((path, index) => <path key={index} className={`eye-light-pose eye-light-pose--${index}`} d={path} />)}
      </g>}
    </g>
  </svg>;
}
