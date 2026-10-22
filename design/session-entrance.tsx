import { useRef, useState } from 'react';
import { CardTurnFrame } from '../src/components/CardTurnFrame';
import { CardScrollFrame } from '../src/components/CardScrollFrame';
import { StudyFooter } from '../src/components/StudyFooter';
import { ShowAnswerButton } from '../src/components/ShowAnswerButton';
import { ModeAtmosphere } from '../src/components/ModeAtmosphere';
import { useSessionEntrance } from '../src/hooks/useSessionEntrance';
import { useCardTurn } from '../src/hooks/useCardTurn';
import { useHoldToEdit } from '../src/hooks/useHoldToEdit';
import type { CardFace } from '../src/types/editorUi';
import '../src/index.css';
import '../src/components/SessionEntrance.css';

/** Inspect the production entry latch and fixed surfaces without decks or study records.
 * @returns A disposable text/picture readiness sample with an explicit motion preview.
 */
export function SessionEntrancePreview() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [entry, setEntry] = useState(0);
  const [dataReady, setDataReady] = useState(false);
  const [picture, setPicture] = useState(false);
  const [face, setFace] = useState<CardFace>('front');
  const [motion, setMotion] = useState(false);
  const [fadeStarts, setFadeStarts] = useState(0);
  const ready = useSessionEntrance({ identity:String(entry), ready:dataReady, contentKey:String(picture), rootRef });
  const hold = useHoldToEdit({ identity:String(entry), disabled:true, onEdit:() => undefined });
  const turn = useCardTurn({ identity:String(entry), face, disabled:!ready, locked:!ready, onGestureStart:hold.dismiss,
    onFlip:() => setFace(previous => previous === 'front' ? 'back' : 'front') });
  const open = (withPicture: boolean, prepared: boolean) => { setFace('front'); setFadeStarts(0); setEntry(previous => previous + 1); setPicture(withPicture); setDataReady(prepared); };
  return <div className={motion ? 'preview-entry-motion' : ''}>
    <style>{`
      body { margin:0; background:var(--kit-bg); color:#e5e5e5; }
      .entry-preview-tools { position:fixed; top:4px; right:4px; z-index:50; width:170px; padding:8px; border-radius:8px; background:#171719; font:11px/1.5 system-ui; }
      .entry-preview-tools summary { cursor:pointer; }
      .entry-preview-tools button { display:block; min-height:32px; width:100%; text-align:left; }
      .entry-preview-tools label { display:flex; gap:6px; align-items:center; }
      .entry-preview-header { height:56px; min-height:56px; padding:16px 20px; font:14px system-ui; }
      .entry-preview-progress { height:24px; min-height:24px; padding:8px 20px; }
      .entry-preview-progress::after { content:''; display:block; height:4px; background:#343633; border-radius:2px; }
      .entry-preview-copy { font:20px/1.5 system-ui; }
      .entry-preview-copy p { margin-bottom:16px; }
      .preview-entry-motion .session-entrance > header,
      .preview-entry-motion .session-entrance > .study-progress,
      .preview-entry-motion .session-entrance[data-entry-ready="true"] > .study-card-area,
      .preview-entry-motion .session-entrance[data-entry-ready="true"] > .study-footer { animation:session-entry-fade 160ms ease-out both; }
    `}</style>
    <details className="entry-preview-tools"><summary>Entrance controls</summary>
      <button type="button" onClick={() => open(false, true)}>Open text</button>
      <button type="button" onClick={() => open(true, true)}>Open picture</button>
      <button type="button" onClick={() => open(true, false)}>Prepare slowly</button>
      <button type="button" onClick={() => setDataReady(true)}>Data ready</button>
      <label><input type="checkbox" checked={motion} onChange={event => setMotion(event.target.checked)} />Preview motion</label>
      <output>{ready ? 'Ready' : 'Preparing'} · {face} · entry {entry} · fades {fadeStarts}</output>
    </details>
    <main key={entry} ref={rootRef} className="study-session session-entrance flex flex-col h-[100dvh] select-none" data-entry-ready={ready} aria-busy={!ready} aria-label="Deck entrance sample" onAnimationStart={event => {
      if (event.animationName === 'session-entry-fade' && event.target instanceof HTMLElement && event.target.classList.contains('study-card-area')) setFadeStarts(previous => previous + 1);
    }}>
      <ModeAtmosphere mode="study" />
      <header className="entry-preview-header">Light and memory</header>
      <div className="study-progress entry-preview-progress" />
      <CardTurnFrame controller={turn} holdBindings={hold.bindings} locked={!ready} onEdit={() => undefined}
        className="study-card-area flex-1 min-h-0 relative overflow-hidden"
        front={<CardScrollFrame visible={ready && face === 'front'} contentKey={String(picture)}><div className="entry-preview-copy"><p>Which light crosses the room?</p>{picture && <img src="/art/navigation/study.jpg" alt="A sample painting" />}</div></CardScrollFrame>}
        back={<CardScrollFrame visible={ready && face === 'back'} contentKey="answer"><p className="entry-preview-copy">The afternoon light.</p></CardScrollFrame>} />
      {!ready && <div className="session-entrance-status" role="status"><span className="sr-only">Opening deck…</span><span className="session-entrance-track" aria-hidden="true" /></div>}
      <StudyFooter face={face} onFlip={turn.flip} disabled={!ready} inert={!ready} seenCount={3}
        frontActions={<ShowAnswerButton onReveal={turn.flip} />} backActions={<span />} />
    </main>
  </div>;
}
