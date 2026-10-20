import { RatingGlyph } from '../src/components/RatingGlyph';
import { RATING_ART } from '../src/components/art/ratingArt';
import previous from './arrow-before.json';
import '../src/index.css';

/** Compare the original and revised Again silhouette in the same pigment.
 * @returns A developer-only shape comparison at enlarged and actual sizes.
 */
export function ArrowStudy() {
  const old = <svg viewBox="0 0 24 24" width="128" height="128" shapeRendering="crispEdges" aria-hidden="true">{previous.flatMap((row,y)=>Array.from(row,(shade,x)=>shade === '.' ? null : <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill={RATING_ART.again.palette[Number(shade)-1]}/>))}</svg>;
  return <main className="arrow-board dark"><style>{`
    body { margin:0; background:#090b0a; }.arrow-board { max-width:620px; padding:36px 24px 48px; margin:auto; color:#e5e9df; font-family:-apple-system,BlinkMacSystemFont,sans-serif; }
    .arrow-board h1 { font-size:26px; font-weight:650; letter-spacing:-.03em; }.arrow-board p { color:#9fa99f; font-size:14px; line-height:1.7; margin-top:12px; }
    .arrow-comparison { display:grid; grid-template-columns:1fr 1fr; gap:32px; margin-top:36px; text-align:center; }.arrow-comparison figure { margin:0; }.arrow-comparison svg { display:block; margin:24px auto; }.arrow-comparison .rating-glyph { --rating-size:128px; }.arrow-comparison figcaption { font-size:13px; }
    .arrow-comparison .actual svg { width:64px; height:64px; --rating-size:64px; }.arrow-board .note { margin-top:32px; }
  `}</style><h1>KIT / A little more depth</h1><p>The same crimson palette. The same curve, with a clearer top face and a continuous shaded side.</p><section className="arrow-comparison" aria-label="Again shape comparison"><figure><figcaption>Before</figcaption>{old}<div className="actual">{old}</div></figure><figure><figcaption>Now</figcaption><RatingGlyph rating="again"/><div className="actual"><RatingGlyph rating="again"/></div></figure></section><p className="note">Enlarged above; normal study size below. The small flip ribbon underneath the eye is a separate symbol.</p></main>;
}
