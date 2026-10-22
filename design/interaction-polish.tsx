import { EyeGlyph } from '../src/components/EyeGlyph';
import { HoldEditAction } from '../src/components/HoldEditAction';
import { HoldEditFeedback } from '../src/components/HoldEditFeedback';
import { useHoldToEdit } from '../src/hooks/useHoldToEdit';
import { StudyFooter } from '../src/components/StudyFooter';
import { ShowAnswerButton } from '../src/components/ShowAnswerButton';
import { RatingGlyph } from '../src/components/RatingGlyph';
import { useState } from 'react';
import type { CardFace } from '../src/types/editorUi';
import '../src/index.css';

/** Compare production eye/hold art with sample content and no library writes.
 * @returns A development-only page; theme comes from this page's URL, not app preferences.
 */
export function InteractionPolish() {
  const hold = useHoldToEdit({ identity:'preview', onEdit:() => undefined });
  const [footerFace, setFooterFace] = useState<CardFace>('front');
  const [previewFade, setPreviewFade] = useState(false);
  const [fadeTimes, setFadeTimes] = useState<string[]>([]);
  const flipFooter = () => setFooterFace(face => face === 'front' ? 'back' : 'front');
  return <main className="interaction-polish">
    <style>{`
      body { margin:0; background:#f7f6f1; color:#30352f; }
      .dark body { background:#080909; color:#ecebe4; }
      .interaction-polish { max-width:760px; padding:32px 24px; margin:auto; font-family:-apple-system,BlinkMacSystemFont,sans-serif; }
      .interaction-polish h1 { font-size:21px; font-weight:500; margin:0 0 28px; }
      .eye-comparison { display:grid; grid-template-columns:1fr 1fr; text-align:center; gap:32px; }
      .eye-comparison figure { margin:0; }
      .eye-comparison svg { margin:auto; }
      .eye-comparison figcaption { font-size:13px; opacity:.65; margin-top:4px; }
      .hold-preview { position:relative; height:280px; margin:40px auto 0; width:min(100%,400px); background:#eeeee7; }
      .dark .hold-preview { background:#171919; }
      .preview-card-content { text-align:center; padding:48px 24px; font:italic 24px/1.4 Baskerville,Georgia,serif; }
      .hold-preview .hold-edit-strip { bottom:20px; }
      .preview-note { max-width:400px; margin:16px auto; font-size:13px; line-height:1.6; opacity:.55; }
      .previous-preview { position:relative; display:flex; flex-direction:column; justify-content:flex-end; width:min(100%,400px); height:340px; margin:32px auto 0; background:var(--kit-bg); }
      .preview-force-fade .study-action-layer { transition:opacity 150ms ease-out,visibility 0s linear 150ms; }
      .preview-force-fade .study-action-layer.is-current { transition-delay:0s; }
      .fade-preview-option { display:flex; gap:10px; align-items:center; max-width:400px; margin:24px auto 0; font-size:13px; }
      .hold-preview[data-card-edit-lock] .preview-card-content { opacity:.35; }
    `}</style>
    <h1>Reveal &amp; hold</h1>
    <section className="eye-comparison" aria-label="Eye comparison">
      <figure><EyeGlyph variant="aureole" idle /><figcaption>Study</figcaption></figure>
      <figure><EyeGlyph variant="practice" idle /><figcaption>Practice</figcaption></figure>
    </section>
    <section className="study-session hold-preview" aria-label="Sample hold area">
      <div className="card-turn-frame" tabIndex={0} {...hold.bindings} style={{ position:'relative', height:'100%' }}>
        <div className="preview-card-content">Hold here.</div>
        {(hold.holding || hold.activated) && <HoldEditFeedback holding={hold.holding} activated={hold.activated} point={hold.point} />}
        {hold.offered && <HoldEditAction onEdit={hold.edit} onDismiss={hold.dismiss} />}
      </div>
    </section>
    <p className="preview-note">Production artwork and hold controls, using sample content. App preferences and decks stay untouched.</p>
    <label className="fade-preview-option"><input type="checkbox" checked={previewFade} onChange={event => setPreviewFade(event.target.checked)} />Preview fades on this sample, including with Reduce Motion</label>
    <section className={`study-session previous-preview ${previewFade ? 'preview-force-fade' : ''}`} aria-label="Footer controls preview" onTransitionEnd={event => {
      if (event.propertyName === 'opacity' && event.target instanceof HTMLElement && event.target.classList.contains('study-action-layer')) {
        setFadeTimes(previous => [...previous.slice(-3), `${Math.round(event.elapsedTime * 1000)}ms`]);
      }
    }}>
      <StudyFooter face={footerFace} seenCount={3} onFlip={flipFooter} leading={<button type="button" className="kit-icon-button study-previous-control text-[#777] dark:text-[#aaa]" aria-label="Previous card preview">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M8 4 3 9l5 5M3 9h11a6 6 0 0 1 0 12" /></svg>
      </button>}
        frontActions={<ShowAnswerButton onReveal={flipFooter} />}
        backActions={<div className="rating-choices" role="group" aria-label="Sample recall choices">{(['again', 'hard', 'good', 'easy'] as const).map(rating => <button type="button" className="rating-control" key={rating}><RatingGlyph rating={rating} /><span className="rating-label">{rating[0].toUpperCase() + rating.slice(1)}</span></button>)}</div>}
      />
    </section>
    <p className="preview-note" role="status">{fadeTimes.length ? `Completed fades: ${fadeTimes.join(', ')}` : 'Turn the two paper controls to compare. This sample saves nothing.'}</p>
  </main>;
}
