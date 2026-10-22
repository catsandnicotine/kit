import { useState } from 'react';
import { CardScrollFrame } from '../src/components/CardScrollFrame';
import { CardTurnFrame } from '../src/components/CardTurnFrame';
import { RatingGlyph } from '../src/components/RatingGlyph';
import { ReviewChoices } from '../src/components/ReviewChoices';
import { ShowAnswerButton } from '../src/components/ShowAnswerButton';
import { StudyFooter } from '../src/components/StudyFooter';
import { ModeAtmosphere } from '../src/components/ModeAtmosphere';
import { HoldEditFeedback } from '../src/components/HoldEditFeedback';
import { HoldEditAction } from '../src/components/HoldEditAction';
import { useCardTurn } from '../src/hooks/useCardTurn';
import { useHoldToEdit } from '../src/hooks/useHoldToEdit';
import type { CardFace } from '../src/types/editorUi';
import '../src/index.css';

/** Exercise retained controls and real turns without decks, counts or ratings.
 * @returns A data-free full-viewport regression fixture with explicit lag states.
 */
export function SessionLayout() {
  const [face, setFace] = useState<CardFace>('front');
  const [heldLayout, setHeldLayout] = useState<CardFace | 'controller'>('controller');
  const [identity, setIdentity] = useState(0);
  const [practice, setPractice] = useState(false);
  const [content, setContent] = useState('short');
  const [showImage, setShowImage] = useState(false);
  const [showBounds, setShowBounds] = useState(false);
  const [enableHold, setEnableHold] = useState(false);
  const [editStatus, setEditStatus] = useState('');
  const hold = useHoldToEdit({ identity:`fixture:${identity}:${face}`, disabled:!enableHold, onEdit:() => setEditStatus(`Edit selected for the ${face} sample. Nothing was saved.`) });
  const turn = useCardTurn({ face, identity:String(identity), disabled:hold.activated || hold.offered, locked:hold.locked,
    onFlip:() => setFace(previous => previous === 'front' ? 'back' : 'front'), onGestureStart:hold.dismiss });
  const layoutFace = heldLayout === 'controller' ? turn.layoutFace : heldLayout;
  const mismatch = (nextFace: CardFace, nextLayout: CardFace) => {
    setFace(nextFace);
    setHeldLayout(nextLayout);
  };
  return <>
    <style>{`
      body { margin:0; color:#e5e5e5; background:var(--kit-bg); }
      .session-layout-tools { position:fixed; top:4px; right:4px; z-index:50; width:190px; font:11px/1.4 system-ui; background:#171719; border-radius:8px; padding:6px; }
      .session-layout-tools summary { cursor:pointer; padding:4px; }
      .session-layout-tools label { display:flex; justify-content:space-between; gap:8px; margin:8px 0; }
      .session-layout-tools select { max-width:110px; font:inherit; color:inherit; background:#29292b; }
      .session-layout-tools button { display:block; width:100%; min-height:32px; padding:5px; text-align:left; }
      .session-layout-heading { display:flex; align-items:center; height:56px; min-height:56px; padding:8px 20px; }
      .session-layout-heading output { font-size:12px; opacity:.6; }
      .session-layout-progress { height:24px; min-height:24px; padding:8px 20px; }
      .session-layout-progress::after { content:''; display:block; height:4px; background:#343633; border-radius:2px; }
      .session-layout-copy { max-width:620px; margin:auto; font:20px/1.5 system-ui; }
      .session-layout-copy strong { display:block; margin-bottom:16px; }
      [data-show-bounds="true"] .card-turn-surface { outline:1px solid #a79e84; outline-offset:-1px; }
      [data-show-bounds="true"] .card-scroll-edge { outline:1px solid #778d98; outline-offset:-1px; }
    `}</style>
    <details className="session-layout-tools">
      <summary>Fixture controls</summary>
      <label>Layout <select aria-label="Layout fixture" value={heldLayout} onChange={event => setHeldLayout(event.target.value as CardFace | 'controller')}>
        <option value="controller">Real controller</option><option value="front">Hold front</option><option value="back">Hold back</option>
      </select></label>
      <label>Content <select aria-label="Sample content" value={content} onChange={event => { setContent(event.target.value); setShowImage(false); }}><option value="short">Short text</option><option value="tall">Long text</option><option value="image">Late image</option></select></label>
      <label>Practice <input type="checkbox" checked={practice} onChange={event => setPractice(event.target.checked)} /></label>
      <label>Face bounds <input type="checkbox" checked={showBounds} onChange={event => setShowBounds(event.target.checked)} /></label>
      <label>Enable hold <input type="checkbox" checked={enableHold} onChange={event => setEnableHold(event.target.checked)} /></label>
      {content === 'image' && <button type="button" onClick={() => setShowImage(value => !value)}>{showImage ? 'Remove sample image' : 'Load sample image'}</button>}
      <button type="button" onClick={() => mismatch('back', 'front')}>Answer with front layout</button>
      <button type="button" onClick={() => mismatch('front', 'back')}>Question with back layout</button>
      <button type="button" onClick={() => { setHeldLayout('controller'); setIdentity(value => value + 1); setFace('front'); }}>Reset sample</button>
      {editStatus && <output role="status">{editStatus}</output>}
    </details>
    <main className={`study-session ${layoutFace === 'front' ? 'study-session--question' : ''} flex flex-col h-[100dvh] select-none`} aria-label="Session layout sample" data-face={face} data-layout-face={layoutFace} data-moving={turn.moving} data-show-bounds={showBounds}>
      <ModeAtmosphere mode={practice ? 'practice' : 'study'} />
      <header className="session-layout-heading"><output>{face} / layout {layoutFace}</output></header>
      <div className="study-progress session-layout-progress" />
      <CardTurnFrame controller={turn} holdBindings={hold.bindings} onEdit={hold.edit} locked={hold.locked}
        className={`study-card-area flex-1 min-h-0 relative overflow-hidden ${layoutFace === 'front' ? 'study-card-area--question' : ''}`}
        front={<CardScrollFrame contentKey={`sample-question:${content}`} visible={face === 'front'}><div className="session-layout-copy"><strong>Which light crosses the room?</strong><p>Drag this sample to turn it. No study history is saved.</p>{content === 'tall' && Array.from({ length:16 }, (_, index) => <p key={index} style={{ marginTop:24 }}>The quiet room changes as afternoon light falls across the wall. This repeated sample gives the card enough material to scroll naturally.</p>)}{content === 'image' && showImage && <img src="/art/navigation/study.jpg" alt="A sample painting" />}</div></CardScrollFrame>}
        back={<CardScrollFrame contentKey={`sample-answer:${content}`} visible={face === 'back'}><div className="session-layout-copy"><strong>The afternoon light.</strong><p>These controls retain their own geometry while the card turns.</p>{content === 'tall' && Array.from({ length:12 }, (_, index) => <p key={index} style={{ marginTop:24 }}>An answer can contain a longer explanation. Its scrolling area stays separate from the action artwork below it.</p>)}{content === 'image' && showImage && <img src="/art/navigation/practice.jpg" alt="A second sample painting" />}</div></CardScrollFrame>}
      >
        {(hold.holding || hold.activated) && <HoldEditFeedback holding={hold.holding} activated={hold.activated} point={hold.point} />}
        {hold.offered && <HoldEditAction onEdit={hold.edit} onDismiss={hold.dismiss} face={face} />}
      </CardTurnFrame>
      <StudyFooter face={face} layoutFace={layoutFace} seenCount={3} onFlip={turn.flip}
        frontActions={<ShowAnswerButton onReveal={turn.flip} practice={practice} />}
        backActions={practice ? <ReviewChoices onRepeat={() => undefined} onPutAside={() => undefined} selected={null} pending={false} /> : <div className="rating-choices" role="group" aria-label="Sample recall choices">{(['again', 'hard', 'good', 'easy'] as const).map(rating => <button type="button" className="rating-control" key={rating}><RatingGlyph rating={rating} /><span className="rating-label">{rating[0].toUpperCase() + rating.slice(1)}</span><span className="rating-interval">{({ again:'1 min', hard:'5 min', good:'1 day', easy:'4 days' })[rating]}</span></button>)}</div>}
      />
    </main>
  </>;
}
