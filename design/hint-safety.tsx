import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CardSideEditor } from '../src/components/CardSideEditor';
import { CardTurnFrame } from '../src/components/CardTurnFrame';
import { CardScrollFrame } from '../src/components/CardScrollFrame';
import { useCardTurn } from '../src/hooks/useCardTurn';
import { useHoldToEdit } from '../src/hooks/useHoldToEdit';
import { renderLegacyCardHints } from '../src/lib/cardHints';
import type { CardSideEditorHandle } from '../src/types/cardBlocks';
import type { CardFace } from '../src/types/editorUi';
import '../src/index.css';

const original = '<div><p>Which light crosses the room?</p><a class="hint" onclick="this.style.display=\'none\';document.getElementById(\'hint_Clue\').style.display=\'\';return false;" href="#">Show Hint</a><span id="hint_Clue" style="display:none">The <span><b>quiet afternoon</b></span> light.</span></div>';

/** Exercise saved hints and authoring without importing or updating a real deck.
 * @returns Real turn/hold/editor surfaces with a read-only serialization check.
 */
export function HintSafety() {
  const [face, setFace] = useState<CardFace>('front');
  const [edits, setEdits] = useState(0);
  const [holds, setHolds] = useState(0);
  const [serialized, setSerialized] = useState<string | null>(null);
  const editor = useRef<CardSideEditorHandle>(null);
  const hold = useHoldToEdit({ identity:`hint:${face}`, disabled:false, onEdit:() => setHolds(value => value + 1) });
  const turn = useCardTurn({ face, identity:'hint-sample', disabled:false, locked:false,
    onFlip:() => setFace(value => value === 'front' ? 'back' : 'front'), onGestureStart:hold.dismiss });
  return <main style={{ maxWidth:760, margin:'0 auto', padding:24, color:'#e5e5e5', fontFamily:'system-ui' }}>
    <h1 style={{ fontSize:20 }}>Saved hint compatibility</h1>
    <p style={{ fontSize:13, opacity:.65 }}>Data-free sample. Opening a hint should not flip the card or start edit.</p>
    <output data-current-face={face} data-edit-holds={holds}>Face: {face} · edit offers: {holds}</output>
    <CardTurnFrame controller={turn} holdBindings={hold.bindings} onEdit={hold.edit} locked={false} className="relative overflow-hidden" front={<CardScrollFrame contentKey="old-hint" visible={face === 'front'}><div dangerouslySetInnerHTML={{ __html:renderLegacyCardHints(original) }} /></CardScrollFrame>} back={<CardScrollFrame contentKey="answer" visible={face === 'back'}><p>The afternoon light.</p></CardScrollFrame>}>
      <style>{`.card-turn-frame { height:260px; margin:16px 0 28px; } .side-text { font-size:17px; } details.hint > summary { min-height:44px; cursor:pointer; }`}</style>
    </CardTurnFrame>
    <h2 style={{ fontSize:17 }}>Editor</h2>
    <p style={{ fontSize:13, opacity:.65 }}>The clue stays visible for authoring. Reading untouched HTML should preserve its saved hint markup.</p>
    <CardSideEditor ref={editor} label="Front" initialHtml={original} onChange={() => setEdits(value => value + 1)} onAddImage={() => undefined} />
    <button type="button" style={{ minHeight:44, padding:'8px 0' }} onClick={() => setSerialized(editor.current?.getHtml() ?? '')}>Read editor HTML</button>
    <p><output data-html-unchanged={serialized === original} data-draft-edits={edits}>{serialized === null ? 'Not read yet.' : serialized === original ? 'Saved HTML unchanged.' : 'Draft differs from the original.'} Edits: {edits}</output></p>
  </main>;
}
document.documentElement.classList.add('dark');
document.documentElement.dataset.theme = 'black';
createRoot(document.getElementById('hint-safety')!).render(<HintSafety />);
