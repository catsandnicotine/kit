import { useState } from 'react';
import { EyeGlyph } from '../src/components/EyeGlyph';
import type { EyeHalo } from '../src/types/pixelArt';
import '../src/index.css';

const HALOS: { id: EyeHalo; title: string; note: string }[] = [
  { id: 'oval', title: '01 / Sparse oval', note: 'Eight short marks. The app’s new default.' },
  { id: 'rays', title: '02 / Radiant', note: 'A little more reach, with stepped diagonal rays.' },
  { id: 'beads', title: '03 / Pinpoints', note: 'A quieter constellation around the eye.' },
  { id: 'arc', title: '04 / Broken halo', note: 'Longer fragments suggest an oval ring.' },
];

/** Compare platinum halos around the chosen emerald eye.
 * @returns A developer-only board; selection changes only its preview.
 */
export function HaloStudy() {
  const [halo, setHalo] = useState<EyeHalo>('oval');
  const [light, setLight] = useState(false);
  const [motion, setMotion] = useState(false);
  const [lettering, setLettering] = useState('painted');
  return <main className={`halo-study ${light ? 'halo-light' : 'dark'}`}>
    <style>{`
      body { margin:0; background:#090b0a; }
      .halo-study { min-height:100dvh; padding:36px max(24px,calc((100vw - 1040px)/2)) 48px; background:#090b0a; color:#e3e9e5; font-family:-apple-system,BlinkMacSystemFont,sans-serif; }
      .halo-study.halo-light { background:#f5f5ef; color:#34413a; }
      .halo-light .reveal-halo { fill:#606d69; opacity:.88; }.halo-light .reveal-eye-metal { fill:#a5b2ac; }.halo-light .reveal-caption { color:#56645e; }
      .halo-heading { display:flex; align-items:center; justify-content:space-between; gap:24px; }
      .halo-study h1 { font-size:27px; font-weight:650; letter-spacing:-.04em; }.halo-study .intro { margin:12px 0 28px; max-width:560px; font-size:14px; line-height:1.65; opacity:.65; }
      .halo-study button { border:0; background:transparent; color:inherit; cursor:pointer; }
      .halo-theme { min-height:44px; padding:0 14px; background:#cfd9d222!important; border-radius:8px; font-size:13px; }
      .halo-options { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:24px; }
      .halo-option { text-align:left; padding:0 0 20px; }
      .halo-option .reveal-eye { display:block; width:184px; height:184px; max-width:100%; margin:12px auto 0; }
      .halo-option .reveal-caption { display:block; text-align:center; margin:0 auto 28px; }
      .halo-option strong { font-size:14px; font-weight:600; }.halo-option[aria-pressed=true] strong { text-decoration:underline; text-underline-offset:7px; }
      .halo-option p { font-size:12px; line-height:1.6; opacity:.55; margin-top:12px; }
      .halo-bottom { margin-top:24px; display:grid; grid-template-columns:1fr 1fr; gap:64px; align-items:center; }
      .halo-preview { background:#000; min-height:310px; display:flex; flex-direction:column; align-items:center; justify-content:center; border-radius:16px; }
      .halo-light .halo-preview { background:#fffefa; }
      .halo-preview .reveal-eye { width:184px; height:200px; }.halo-preview .reveal-caption { margin-top:0; }
      .halo-type h2 { font-size:17px; font-weight:600; margin-bottom:8px; }.halo-type p { font-size:13px; line-height:1.65; opacity:.6; margin-bottom:20px; }
      .halo-type-options { display:flex; gap:24px; align-items:baseline; flex-wrap:wrap; }.halo-type-options button { min-width:44px; min-height:44px; }.halo-type-options [aria-pressed=true] { text-decoration:underline; text-underline-offset:9px; }
      .halo-type-options .reveal-caption { font-size:24px; }
      .lettering-book { font-family:Georgia,'Times New Roman',serif; letter-spacing:0; }.lettering-inscription { font-family:Didot,'Bodoni 72','Times New Roman',serif; letter-spacing:.08em; }
      .halo-footnote { margin-top:28px; font-size:12px; line-height:1.7; opacity:.45; max-width:700px; }
      .eye-preview-toggle { margin-top:20px; padding:10px 14px; background:#cfd9d222!important; border-radius:8px; font-size:13px; }
      .force-eye-motion .reveal-eye--idle { animation:eye-idle-float 5.6s ease-in-out infinite!important; }
      .force-eye-motion .eye-halo-ray { animation:eye-ray-breathe 6.4s ease-in-out infinite!important; }
      .force-eye-motion .eye-halo-breath { animation:eye-ray-light 6.4s ease-in-out infinite!important; }
      .force-eye-motion .eye-light-pose { animation:eye-specular-pass 2.8s steps(1,end) infinite!important; }
      .force-eye-motion .eye-light-pose--1 { animation-delay:90ms!important; }.force-eye-motion .eye-light-pose--2 { animation-delay:180ms!important; }.force-eye-motion .eye-light-pose--3 { animation-delay:270ms!important; }.force-eye-motion .eye-light-pose--4 { animation-delay:360ms!important; }.force-eye-motion .eye-light-pose--5 { animation-delay:450ms!important; }
      .halo-study button:focus-visible { outline:2px solid #9abfad; outline-offset:6px; }
      @media(max-width:700px) { .halo-study { padding:24px 20px 36px; }.halo-study h1 { font-size:24px; }.halo-options { grid-template-columns:repeat(2,minmax(0,1fr)); gap:14px; }.halo-option .reveal-eye { width:160px; height:160px; }.halo-option .reveal-caption { margin-bottom:24px; }.halo-bottom { grid-template-columns:1fr; gap:24px; }.halo-preview { min-height:260px; } }
    `}</style>
    <div className="halo-heading"><h1>KIT / Platinum light</h1><button className="halo-theme" onClick={() => setLight(value => !value)}>{light ? 'Dark ground' : 'Light ground'}</button></div>
    <p className="intro">The fourth eye, kept intact. Cooler silver light, an emerald iris, and a small invitation underneath. Tap a halo to compare it below.</p>
    <section className="halo-options" aria-label="Platinum halo directions">{HALOS.map(option => <button key={option.id} className="halo-option" aria-pressed={halo === option.id} onClick={() => setHalo(option.id)}><EyeGlyph variant="aureole" halo={option.id} /><span className="reveal-caption">see</span><strong>{option.title}</strong><p>{option.note}</p></button>)}</section>
    <section className="halo-bottom" aria-label="Selected eye and lettering">
      <div className={`halo-preview ${motion ? 'force-eye-motion' : ''}`}><EyeGlyph variant="aureole" halo={halo} idle={motion} /><span className={`reveal-caption lettering-${lettering}`}>Click 2 see</span></div>
      <div className="halo-type"><h2>A little painted lettering</h2><p>Small lowercase serif italics. The first is the app’s default; the others compare a more bookish and a finer inscription-like voice.</p><div className="halo-type-options" aria-label="Lettering treatments">{[['painted','Soft serif'],['book','Book italic'],['inscription','Fine inscription']].map(([id,label]) => <button key={id} aria-label={label} aria-pressed={lettering === id} onClick={() => setLettering(id!)}><span className={`reveal-caption lettering-${id}`}>see</span></button>)}</div><button type="button" className="eye-preview-toggle" aria-pressed={motion} onClick={() => setMotion(value => !value)}>{motion ? 'Pause idle motion' : 'Play idle motion'}</button><p>Explicit motion preview. The app respects Reduce Motion.</p></div>
    </section>
    <p className="halo-footnote">Original pixel drawings. The lettering borrows a restrained, old-painting feeling; it does not reproduce a historical inscription or claim a single “Christian painting” typeface. Preview choices stay on this board.</p>
  </main>;
}
