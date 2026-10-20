import { useState } from 'react';
import drawing from './satin-ribbon.json';
import '../src/index.css';

const COLOURS = [
  { id:'previous', label:'Before', note:'The previous coral.', palette:drawing.previousPalette, grid:drawing.grid },
  { id:'warm-red', label:'Now', note:'A little closer to red, with warm satin highlights.', palette:drawing.palette, grid:drawing.grid },
];

/** Compare the satin ribbon geometry on light and dark grounds.
 * @returns A developer-only shape study with the physical material references.
 */
export function SatinStudy() {
  const [light,setLight]=useState(false);
  return <main className={`satin-board ${light ? 'satin-light' : 'dark'}`}><style>{`
    body { margin:0; background:#090b0a; }.satin-board { min-height:100dvh; margin:auto; padding:32px max(24px,calc((100vw - 1000px)/2)) 48px; color:#e5e7dc; background:#090b0a; font-family:-apple-system,BlinkMacSystemFont,sans-serif; }.satin-board.satin-light { background:#f4f4ef; color:#28382f; }.satin-heading { display:flex; align-items:center; justify-content:space-between; gap:20px; }.satin-board h1 { font-size:26px; font-weight:650; letter-spacing:-.03em; }.satin-theme { min-height:44px; padding:10px 14px; border:0; border-radius:8px; background:#91a58e24; color:inherit; font-size:13px; cursor:pointer; }.satin-board > p { font-size:14px; line-height:1.65; opacity:.65; margin-top:12px; max-width:620px; }
    .satin-compare { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:28px; margin-top:28px; }.satin-compare figure { margin:0; }.satin-compare svg { display:block; width:160px; height:160px; margin:16px auto; }.satin-compare .actual svg { width:64px; height:64px; }.satin-compare h2 { font-size:15px; font-weight:600; margin-top:24px; }.satin-compare p { font-size:13px; line-height:1.65; opacity:.6; margin-top:10px; }
    .satin-refs { display:grid; grid-template-columns:1fr 1fr; gap:24px; margin-top:20px; max-width:600px; }.satin-refs a { display:block; color:inherit; opacity:.7; font-size:12px; text-decoration:underline; text-underline-offset:4px; }.satin-refs img { display:block; width:100%; height:140px; object-fit:contain; margin-bottom:10px; }.satin-note { font-size:12px!important; margin-top:32px!important; }.satin-note a { color:inherit; text-decoration:underline; text-underline-offset:3px; }
    @media(max-width:660px) { .satin-board h1 { font-size:24px; }.satin-compare { grid-template-columns:1fr; max-width:380px; margin-inline:auto; gap:20px; }.satin-compare figure { display:grid; grid-template-columns:128px 1fr; column-gap:20px; }.satin-compare figure > svg { grid-column:1; grid-row:1; width:128px; height:128px; margin:0; }.satin-compare .actual { grid-column:1; grid-row:2; }.satin-compare .actual svg { margin:0 auto; }.satin-compare figcaption { grid-column:2; grid-row:1/3; align-self:center; }.satin-compare h2 { margin-top:0; }.satin-refs { gap:16px; }.satin-refs img { height:120px; } }
  `}</style><div className="satin-heading"><h1>KIT / Warm red</h1><button type="button" className="satin-theme" onClick={()=>setLight(value=>!value)}>{light ? 'Dark ground' : 'Light ground'}</button></div><p>A warmer, clearer red with a little coral in the light. Enlarged above; actual button size below.</p><section className="satin-compare" aria-label="Satin ribbon comparison">{COLOURS.map(colour=>{
    const art=<>{colour.grid.flatMap((row,y)=>Array.from(row,(shade,x)=>shade==='.'?null:<rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill={colour.palette[Number(shade)-1]}/>))}</>;
    return <figure key={colour.id}><svg viewBox="0 0 32 32" shapeRendering="crispEdges" aria-hidden="true">{art}</svg><div className="actual"><svg viewBox="0 0 32 32" shapeRendering="crispEdges" aria-hidden="true">{art}</svg></div><figcaption><h2>{colour.label}</h2><p>{colour.note}</p></figcaption></figure>;
  })}</section><p className="satin-note">A custom warm-red palette. The photographs below inform the satin folds and sheen.</p><section className="satin-refs" aria-label="Satin photographic references"><a href="https://www.fabricandribbon.co.uk/cdn/shop/files/Satin-DRBlue-3501-10-243-4_80833501-1550-49e4-95ed-fc1ffa03f9b3_1024x1024.jpg?v=1712071714"><img src="https://www.fabricandribbon.co.uk/cdn/shop/files/Satin-DRBlue-3501-10-243-4_80833501-1550-49e4-95ed-fc1ffa03f9b3_1024x1024.jpg?v=1712071714" alt="Blue satin loop showing broad reflected light"/>Satin loop · Fabric and Ribbon</a><a href="https://ameblo.jp/cbc18487/entry-12788575860.html"><img src="https://stat.ameba.jp/user_images/20230209/10/cbc18487/4d/e5/j/o0992099215240742526.jpg" alt="Green satin ribbon being twisted at a pivot"/>Half-turn · ETOKA</a></section></main>;
}
