import drawings from './ribbon-options.json';
import '../src/index.css';

/** Inspect three original ribbon constructions without changing production art.
 * @returns A developer-only concept board at enlarged and real study sizes.
 */
export function RibbonStudy() {
  return <main className="ribbon-board dark"><style>{`
    body { margin:0; background:#090b0a; }.ribbon-board { max-width:1000px; margin:auto; padding:36px 24px 48px; color:#e4e7de; font-family:-apple-system,BlinkMacSystemFont,sans-serif; }.ribbon-board h1 { font-size:26px; font-weight:650; letter-spacing:-.03em; }.ribbon-board > p { margin-top:12px; max-width:620px; font-size:14px; line-height:1.65; color:#a3aaa1; }
    .ribbon-options { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:36px; margin-top:28px; }.ribbon-options figure { margin:0; }.ribbon-options svg { display:block; margin:20px auto; }.ribbon-options h2 { font-size:15px; font-weight:600; margin-top:24px; }.ribbon-options p { font-size:13px; line-height:1.7; color:#a3aaa1; margin-top:12px; }.ribbon-options .small { margin:0 auto; width:64px; height:64px; }
    @media(max-width:660px) { .ribbon-options { grid-template-columns:1fr; max-width:360px; margin-inline:auto; }.ribbon-options figure { display:grid; grid-template-columns:128px 1fr; column-gap:20px; }.ribbon-options figure > svg:not(.small) { grid-column:1; grid-row:1; width:128px; height:128px; }.ribbon-options .small { grid-column:1; grid-row:2; }.ribbon-options figcaption { grid-column:2; grid-row:1/3; align-self:center; } }
  `}</style><h1>KIT / A little character</h1><p>Uneven curves, a real turnover, and little catches of ivory, gold, and cool reflected light. Large above; study size below. These are sketches; the app’s current arrow is unchanged.</p><section className="ribbon-options" aria-label="Ribbon construction options">{drawings.map(option=>{
    const art=<>{option.grid.flatMap((row,y)=>Array.from(row,(shade,x)=>shade==='.'?null:<rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill={option.palette[Number(shade)-1]}/>))}</>;
    return <figure key={option.id}><svg width="160" height="160" viewBox="0 0 32 32" shapeRendering="crispEdges" aria-hidden="true">{art}</svg><svg className="small" width="64" height="64" viewBox="0 0 32 32" shapeRendering="crispEdges" aria-hidden="true">{art}</svg><figcaption><h2>{option.name}</h2><p>{option.description}</p></figcaption></figure>;
  })}</section></main>;
}
