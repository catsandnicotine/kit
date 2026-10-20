import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { RatingGlyph } from '../src/components/RatingGlyph';
import { RATING_ART } from '../src/components/art/ratingArt';
import { CHOICE_FEEDBACK_MS } from '../src/lib/choiceFeedback';
import type { Rating } from '../src/types';
import '../src/index.css';

const RATINGS: Rating[] = ['again', 'hard', 'good', 'easy'];
const FRAME_EXPOSURES = Object.entries(RATING_ART).flatMap(([rating, art]) => {
  let delay = 0;
  return art.frames.map((frame, index) => {
    const rule = `.motion-study.force-motion .rating-glyph--${rating} > .rating-glyph-frame:nth-of-type(${index + 2}) { animation-delay:calc(${delay}ms * var(--sprite-playback, 1))!important; animation-duration:calc(${frame.duration}ms * var(--sprite-playback, 1))!important; }`;
    delay += frame.duration;
    return rule;
  });
}).join('\n');
const MATERIALS = {
  again: ['Coral satin / returning fold', 'A tiny ripple travels from the loose end into the half-turn; the satin reflection follows and settles.'],
  hard: ['Blue steel / planted weight', 'The cap yields one pixel; a narrow reflection crosses its face.'],
  good: ['Green enamel / one gesture', 'The short stroke leads into the long arm; a wet ridge catches light.'],
  easy: ['Jade / two gestures', 'Equal-sized checks draw in succession, with a crisp faceted gleam.'],
};

/**
 * Inspect recall artwork without creating study reviews.
 * @returns A developer-only playback and drawing-inspection view.
 */
export function MotionStudy() {
  const [scale, setScale] = useState(1);
  const [playing, setPlaying] = useState<Rating[]>([]);
  const [pose, setPose] = useState(0);
  const [plays, setPlays] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const play = (ratings: Rating[]) => {
    if (playing.length) return;
    setPose(0);
    setPlaying(ratings);
    setPlays(value => value + 1);
    timer.current = setTimeout(() => { setPlaying([]); timer.current = null; }, CHOICE_FEEDBACK_MS * scale + 40);
  };
  return <main className={`motion-study ${playing.length ? 'force-motion' : ''}`} style={{ '--sprite-playback': scale } as CSSProperties}>
    <style>{`
      body { background:#111313; color:#eeeae4; }
      .motion-study { max-width:960px; margin:auto; padding:40px 24px 64px; font-family:-apple-system,BlinkMacSystemFont,sans-serif; }
      .motion-study h1 { font-size:30px; letter-spacing:-.04em; font-weight:700; }
      .motion-intro { max-width:640px; color:#a7aea6; margin-top:10px; font-size:16px; line-height:1.6; }
      .motion-controls { display:flex; flex-wrap:wrap; align-items:center; gap:16px; margin:28px 0; }
      .motion-controls button, .motion-controls select { background:#eeeae4; color:#161b18; border:0; border-radius:8px; padding:12px 16px; font-size:15px; font-weight:600; }
      .motion-controls button:disabled { opacity:.5; }
      .motion-controls output { font-size:13px; color:#adb5ac; }
      .motion-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:32px; }
      .motion-card { text-align:left; padding:24px 0; background:transparent; border:0; color:inherit; }
      .motion-card .rating-glyph { --rating-size:96px; display:block; margin-bottom:24px; }
      .motion-card strong { display:block; font-size:19px; }
      .motion-card small { display:block; margin-top:8px; font-size:13px; color:#a7aea6; }
      .motion-card p { margin-top:8px; max-width:330px; font-size:14px; color:#a7aea6; line-height:1.5; }
      .motion-scrub { display:flex; gap:16px; align-items:center; margin:20px 0 32px; font-size:14px; color:#c7cdc5; }
      .motion-scrub input { width:240px; accent-color:#83efac; }
      .motion-refs { margin-top:36px; font-size:14px; line-height:1.7; color:#a7aea6; }
      .motion-refs a { text-decoration:underline; text-underline-offset:3px; color:#d7e1d4; }
      .motion-study button:focus-visible, .motion-study select:focus-visible { outline:2px solid #a4ffc3; outline-offset:4px; }
      .motion-study.force-motion .is-feedback .rating-glyph-rest { visibility:hidden!important; }
      .motion-study.force-motion .is-feedback .rating-glyph-frame { display:inline!important; animation-name:pixel-pose!important; animation-timing-function:steps(1,end)!important; animation-fill-mode:none!important; }
      .motion-study.force-motion .is-feedback .rating-glyph-frame:last-child { animation-fill-mode:forwards!important; }
      ${FRAME_EXPOSURES}
      @media(max-width:540px) { .motion-grid { gap:20px; } .motion-card .rating-glyph { --rating-size:72px; } .motion-scrub { flex-wrap:wrap; } }
      ${pose ? `.motion-card .rating-glyph-rest { visibility:hidden!important; } .motion-card .rating-glyph-frame { display:inline!important; animation:none!important; opacity:0; } .motion-card .rating-glyph-frame:nth-of-type(${pose + 1}) { opacity:1; }` : ''}
    `}</style>
    <h1>KIT / Motion study</h1>
    <p className="motion-intro">Tap a symbol to replay. Each has eight separate pixel drawings, with light painted onto its material. The app plays the sequence once in {CHOICE_FEEDBACK_MS} ms.</p>
    <p className="motion-intro">Play is an explicit animation preview. Kit follows your device’s Reduce Motion setting.</p>
    <div className="motion-controls">
      <button type="button" disabled={!!playing.length} onClick={() => play(RATINGS)}>Play all</button>
      <select aria-label="Playback speed" value={scale} disabled={!!playing.length} onChange={event => setScale(Number(event.target.value))}>
        <option value={1}>Normal speed</option><option value={4}>Slow study · 4×</option>
      </select>
      <output aria-live="polite">{plays} {plays === 1 ? 'replay' : 'replays'}</output>
    </div>
    <label className="motion-scrub">{pose ? `Drawing ${pose} of 8` : 'Resting drawing'}
      <input aria-label="Inspect drawing" type="range" min={0} max={8} step={1} value={pose} disabled={!!playing.length} onChange={event => setPose(Number(event.target.value))} />
    </label>
    <div className="motion-grid">
      {RATINGS.map(rating => <button type="button" key={rating} className={`motion-card ${playing.includes(rating) ? 'is-feedback' : ''}`} disabled={!!playing.length} aria-label={`Replay ${rating}`} onClick={() => play([rating])}>
        <RatingGlyph rating={rating} />
        <strong>{rating[0]!.toUpperCase() + rating.slice(1)}</strong>
        <small>{MATERIALS[rating][0]}</small><p>{MATERIALS[rating][1]}</p>
      </button>)}
    </div>
    <p className="motion-refs">References reviewed: <a href="https://terraria.wiki.gg/wiki/Anvil">Terraria’s item silhouettes</a>, <a href="https://www.snk-corp.co.jp/us/anniversary/metalslug30th/history/">SNK’s Metal Slug retrospective artwork</a>, and <a href="https://developer.apple.com/design/human-interface-guidelines/motion">Apple’s motion guidance</a>. These are original Kit sprites; the exposures above are authored for this interface.</p>
  </main>;
}
