import type { CSSProperties } from 'react';
import { RatingGlyph } from '../src/components/RatingGlyph';
import type { Rating } from '../src/types';
import '../src/index.css';

const PREVIOUS = {
  again: ['#ecddbd','#c65b50','#a52b32','#6c202b','#351c25','#fff0d5','#dda582'],
  hard: ['#e3f5ff','#88c8f4','#408fce','#225980','#173b55','#f6fdff','#b5e5ff'],
};

/** Compare the old bright accents with deeper painted pigments.
 * @returns A developer-only board using the actual production sprites.
 */
export function PigmentStudy() {
  return <main className="pigment-board dark">
    <style>{`
      body { margin:0; background:#090b0a; }.pigment-board { max-width:660px; margin:auto; padding:36px 24px 48px; color:#e2e7df; font-family:-apple-system,BlinkMacSystemFont,sans-serif; }
      .pigment-board h1 { font-size:26px; font-weight:650; letter-spacing:-.035em; }.pigment-board p { margin:12px 0 28px; font-size:14px; line-height:1.7; color:#a0aaa3; }
      .pigment-grid { display:grid; grid-template-columns:80px 1fr 1fr; align-items:center; gap:32px 20px; }.pigment-grid > span { font-size:13px; color:#9aa79e; }.pigment-grid > strong { text-align:center; font-size:13px; font-weight:550; }
      .pigment-sprite { display:flex; justify-content:center; align-items:center; min-height:130px; }.pigment-sprite .rating-glyph { --rating-size:96px; }
      .pigment-grid .study-action-caption { color:#d6ddd5; }.pigment-notes { margin-top:36px!important; }
      @media(max-width:420px) { .pigment-grid { grid-template-columns:60px 1fr 1fr; gap:24px 12px; }.pigment-sprite .rating-glyph { --rating-size:72px; }.pigment-sprite { min-height:100px; } }
    `}</style>
    <h1>KIT / Crimson & ink</h1>
    <p>Ink blue and a warmer painted red, with the pink and purple cast removed. The right column is now used in Kit.</p>
    <section className="pigment-grid" aria-label="Recall pigment comparison"><span/><strong>Before</strong><strong>Now</strong>
      {(['again','hard'] as const).map(rating => {
        const previous = Object.fromEntries(PREVIOUS[rating].map((shade,index) => [`--rating-shade-${index+1}`,shade])) as CSSProperties;
        return <Row key={rating} rating={rating} previous={previous} />;
      })}
    </section>
    <p className="pigment-notes">Again moves from pink-lit burgundy to a warm, earthy red. Hard moves from icy blue to deep ink-blue steel. The same palette is used throughout each pixel animation.</p>
  </main>;
}

function Row({ rating, previous }: { rating:Rating; previous:CSSProperties }) {
  return <><span className="study-action-caption">{rating === 'again' ? 'Again' : 'Hard'}</span><div className="pigment-sprite" style={previous}><RatingGlyph rating={rating}/></div><div className="pigment-sprite"><RatingGlyph rating={rating}/></div></>;
}
