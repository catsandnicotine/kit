import { useState } from 'react';
import { EyeGlyph } from '../src/components/EyeGlyph';
import { RatingGlyph } from '../src/components/RatingGlyph';
import { StudyProgressBar } from '../src/components/StudyProgressBar';
import { getStudyProgress } from '../src/lib/studyProgress';
import type { EyeVariant } from '../src/types/pixelArt';
import '../src/index.css';

const EYES: { variant: EyeVariant; name: string; description: string }[] = [
  { variant: 'current', name: '01 / Current', description: 'Sea-glass iris. Ivory rays. The eye already in Kit.' },
  { variant: 'lapis', name: '02 / Lapis', description: 'Deep blue iris. A fine gold lid. Clear and alert.' },
  { variant: 'vesper', name: '03 / Vesper', description: 'Amber light. A lower, quieter lid. Late California sun.' },
  { variant: 'aureole', name: '04 / Aureole', description: 'Emerald iris. A broken gold halo. More ceremonial.' },
];
const SWATCHES = [['Lapis', '#438eff'], ['Vermilion', '#fa7554'], ['Emerald', '#40d88a'], ['Gold', '#edc66e'], ['Ivory', '#fff3d8']];

/** Compare original pixel eyes and honest session progress without touching study data.
 * @returns A developer-only interactive art direction board.
 */
export function ArtStudy() {
  const [selected, setSelected] = useState<EyeVariant>('current');
  const [position, setPosition] = useState(18);
  const [repeat, setRepeat] = useState(false);
  const [light, setLight] = useState(false);
  const queue = Array.from({ length: 60 }, (_, index) => `${index}`);
  if (repeat) queue.push('0');
  const progress = getStudyProgress(queue, position);
  return <main className={`art-study ${light ? 'art-study--light' : 'dark'}`}>
    <style>{`
      body { background:#0b0d0c; }
      .art-study { min-height:100vh; padding:40px max(24px,calc((100vw - 1000px)/2)) 64px; background:#0b0d0c; color:#eeeae0; font-family:-apple-system,BlinkMacSystemFont,sans-serif; }
      .art-study--light { background:#f5f3ee; color:#263c33; --eye-gold:#98702d; }
      .art-study--light .reveal-rays { fill:#343c38; }
      .art-study h1 { font-size:32px; font-weight:700; letter-spacing:-.04em; }
      .art-study .intro { margin-top:12px; max-width:650px; color:#9ca69b; line-height:1.6; font-size:16px; }
      .art-study--light .intro { color:#687264; }
      .art-study .heading { display:flex; gap:20px; align-items:center; justify-content:space-between; }
      .art-study button { border:0; cursor:pointer; }
      .art-theme { padding:10px 15px; border-radius:8px; background:#eee9dd; color:#263c33; font-weight:650; }
      .eye-directions { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:24px; margin:32px 0; }
      .eye-direction { background:transparent; color:inherit; text-align:left; padding:0; }
      .eye-direction .reveal-eye { display:block; width:144px; height:180px; margin:0 auto 24px; }
      .eye-direction strong { display:block; font-size:16px; font-weight:650; }
      .eye-direction[aria-pressed=true] strong { color:#edc66e; text-decoration:underline; text-underline-offset:7px; }
      .art-study--light .eye-direction[aria-pressed=true] strong { color:#87612a; }
      .eye-direction p { margin-top:14px; font-size:13px; line-height:1.6; color:#9ca69b; }
      .art-study--light .eye-direction p { color:#687264; }
      .pigments { display:flex; gap:24px; flex-wrap:wrap; margin:32px 0 48px; }
      .pigments span { font-size:12px; color:#a9aea3; }
      .pigments i { display:block; width:64px; height:10px; margin-bottom:10px; border-radius:2px; }
      .progress-study { display:grid; grid-template-columns:1fr 1fr; gap:48px; align-items:start; }
      .preview-header { display:flex; justify-content:space-between; gap:16px; padding:20px 16px 8px; font-size:15px; font-weight:600; }
      .preview-header small { display:block; text-align:center; font-size:12px; font-weight:500; color:#8d948b; margin-top:4px; }
      .preview-header .counts { display:flex; gap:16px; align-items:center; }
      .preview-header .counts b:nth-child(1) { color:#60a5fa; }.preview-header .counts b:nth-child(2) { color:#f87171; }.preview-header .counts b:nth-child(3) { color:#4ade80; }
      .preview-paper { min-height:360px; background:#000; border-radius:14px; }
      .art-study--light .preview-paper { background:#fdfbf7; }
      .preview-paper > .reveal-eye { display:block; margin:65px auto 24px; }
      .art-study h2 { font-size:21px; font-weight:650; letter-spacing:-.025em; margin-bottom:16px; }
      .progress-explanation p { font-size:14px; line-height:1.7; color:#a1a99d; margin-bottom:20px; }
      .art-study--light .progress-explanation p { color:#687264; }
      .progress-explanation input[type=range] { width:100%; accent-color:#ddd7b3; margin:16px 0; }
      .progress-explanation label { font-size:14px; }
      .progress-explanation .repeat-control { display:flex; gap:10px; margin-top:12px; align-items:center; }
      .rating-strip { display:flex; justify-content:space-between; align-items:center; gap:20px; margin-top:42px; padding-top:24px; }
      .rating-strip .rating-glyph { --rating-size:48px; }
      .art-refs { margin-top:40px; font-size:13px; line-height:1.7; color:#9ca69b; max-width:700px; }
      .art-refs a { color:inherit; text-decoration:underline; text-underline-offset:3px; }
      .art-study button:focus-visible, .art-study input:focus-visible { outline:2px solid #edc66e; outline-offset:6px; }
      @media(max-width:760px) { .eye-directions { grid-template-columns:repeat(2,minmax(0,1fr)); gap:32px 20px; }.progress-study { grid-template-columns:1fr; gap:24px; }.eye-direction .reveal-eye { width:120px; height:150px; }.art-study { padding:24px 20px 48px; } }
    `}</style>
    <div className="heading"><h1>KIT / Light & pigment</h1><button className="art-theme" onClick={() => setLight(value => !value)}>{light ? 'Dark ground' : 'Light ground'}</button></div>
    <p className="intro">Original pixel studies: rich pigment, warm light, and one symbol with room to breathe. The current eye stays in the app. Tap a direction to try it below.</p>
    <section className="eye-directions" aria-label="Eye directions">{EYES.map(eye => <button className="eye-direction" aria-pressed={selected === eye.variant} key={eye.variant} onClick={() => setSelected(eye.variant)}><EyeGlyph variant={eye.variant} /><strong>{eye.name}</strong><p>{eye.description}</p></button>)}</section>
    <div className="pigments" aria-label="Proposed pigment family">{SWATCHES.map(([name, color]) => <span key={name}><i style={{ background:color }} />{name}</span>)}</div>
    <section className="progress-study" aria-label="Progress demonstration">
      <div className="preview-paper"><div className="preview-header"><span aria-hidden="true">‹</span><span>Welcome to Kit<small>Learn</small></span><span className="counts" aria-label="Illustrative queue counts"><b>0</b><b>0</b><b>{progress.remaining}</b></span></div><StudyProgressBar progress={progress} /><EyeGlyph variant={selected} /></div>
      <div className="progress-explanation"><h2>Work left. No false finish.</h2><p>The bar measures distinct cards cleared from this session. A card queued to repeat stays unfinished. Future scheduled reviews are outside this session.</p><label htmlFor="progress-position">Try a longer session · {position} encounters rated</label><input id="progress-position" aria-label="Encounters rated" type="range" min="0" max="60" value={position} onChange={event => setPosition(Number(event.target.value))} /><label className="repeat-control"><input type="checkbox" checked={repeat} onChange={event => setRepeat(event.target.checked)} />Keep the first card queued to repeat</label><div className="rating-strip" aria-label="Current recall artwork retained">{(['again','hard','good','easy'] as const).map(rating => <RatingGlyph rating={rating} key={rating} />)}</div></div>
    </section>
    <p className="art-refs">References: the lapis robe, scarlet cloak, green lining, and gold light in <a href="https://www.nga.gov/artworks/359-annunciation">Fra Carnevale’s Annunciation</a>; the concentrated imagery and painted gold grounds of <a href="https://www.metmuseum.org/exhibitions/listings/2016/world-in-play/exhibition-galleries">early Italian tarot</a>. These are original Kit drawings, not reproduced cards or religious emblems.</p>
  </main>;
}
