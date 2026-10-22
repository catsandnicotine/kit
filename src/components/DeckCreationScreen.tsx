import { KitHeader } from './KitHeader';
import { useLayoutEffect, useRef, useState } from 'react';
import type { DeckCreationScreenProps } from '../types/deckCreation';
import { DeckEntryChoices } from './DeckEntryChoices';
import { DeckNameForm } from './DeckNameForm';
import { UiIcon } from './UiIcon';

/** A full-screen deck-making flow with one focused step at a time.
 * @param props - Readiness, save status, initial step and navigation callbacks.
 * @returns An opaque page with native focus containment and reversible navigation.
 */
export function DeckCreationScreen({ ready = true, nameLocked, creating, error, initialStep, onCreate, onImport, onCancel }: DeckCreationScreenProps) {
  const screen = useRef<HTMLDialogElement>(null);
  const [step, setStep] = useState(initialStep);
  const [name, setName] = useState('');
  useLayoutEffect(() => {
    if (!screen.current?.open) screen.current?.showModal();
    if (initialStep === 'name') screen.current?.querySelector<HTMLInputElement>('#new-deck-name')?.focus();
  }, [initialStep]);
  const back = () => {
    if (creating) return;
    if (step === 'name' && initialStep === 'choose' && !nameLocked) setStep('choose');
    else onCancel();
  };
  return <dialog ref={screen} className="deck-creation-screen" aria-labelledby="deck-creation-title" onCancel={event => { event.preventDefault(); back(); }}>
    <KitHeader quiet leading={<button type="button" className="kit-icon-button" aria-label="Back" onClick={back} disabled={creating}><UiIcon name="back" /></button>} />
    <div className={`deck-creation-content deck-creation-content--${step}`}>
      <h1 id="deck-creation-title">{step === 'choose' ? 'New deck' : 'Deck name'}</h1>
      {step === 'choose' ? <DeckEntryChoices onCreate={() => setStep('name')} onImport={() => { screen.current?.close(); onImport(); }} disabled={creating || !ready} /> : <DeckNameForm name={name} onNameChange={setName} {...(nameLocked !== undefined ? { nameLocked } : {})} creating={creating} disabled={!ready} error={error} onCreate={onCreate} />}
    </div>
  </dialog>;
}
