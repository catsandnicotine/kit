import { KitHeader } from './KitHeader';
import { useLayoutEffect, useRef } from 'react';
import type { OnboardingAction } from '../types/deckCreation';
import { useOnboardingFeedback } from '../hooks/useOnboardingFeedback';
import { DeckEntryChoices } from './DeckEntryChoices';
import { DeckCreationScreen } from './DeckCreationScreen';
import { EyeGlyph } from './EyeGlyph';
import { RatingGlyph } from './RatingGlyph';
import { UiIcon } from './UiIcon';
import './Onboarding.css';

interface OnboardingProps {
  ready: boolean;
  existingDeckCount: number;
  busyAction: OnboardingAction | null;
  error: string | null;
  onTrySample: () => Promise<void>;
  onCreateDeck: (name: string) => Promise<void>;
  onImportDeck: () => Promise<void>;
  onDismiss: () => void;
}

const RATINGS = [
  { rating: 'again', label: 'Again', meaning: 'Forgot' },
  { rating: 'hard', label: 'Hard', meaning: 'With effort' },
  { rating: 'good', label: 'Good', meaning: 'Got it' },
  { rating: 'easy', label: 'Easy', meaning: 'Instantly' },
] as const;

/** A hands-on first card, then a direct route to the user's own material.
 * @param props - Readiness, existing decks, and first-run callbacks.
 * @returns A skippable demonstration with no saved ratings or automatic sample deck.
 */
export function Onboarding({ ready, existingDeckCount, busyAction, error, onTrySample, onCreateDeck, onImportDeck, onDismiss }: OnboardingProps) {
  const { step, creating, selected, pending, choose, reveal, skipDemo, startCreation, closeCreation } = useOnboardingFeedback(existingDeckCount);
  const heading = useRef<HTMLHeadingElement>(null);
  const previousStep = useRef(step);
  const busy = busyAction !== null;
  useLayoutEffect(() => {
    if (previousStep.current !== step) heading.current?.focus({ preventScroll: true });
    previousStep.current = step;
  }, [step]);

  if (creating) return <DeckCreationScreen initialStep="name" ready={ready} creating={busy} error={error} onCreate={name => { void onCreateDeck(name); }} onImport={() => { void onImportDeck(); }} onCancel={closeCreation} />;
  return <main className={`kit-onboarding kit-onboarding--${step}`}>
    <KitHeader quiet trailing={<button type="button" className="onboarding-skip" onClick={step === 'setup' ? onDismiss : skipDemo} disabled={busy || pending}>{existingDeckCount > 0 ? 'My decks' : 'Skip'}</button>} />

    {step === 'setup' ? <section className="onboarding-setup" aria-labelledby="onboarding-heading">
      <h1 ref={heading} id="onboarding-heading" tabIndex={-1}>{existingDeckCount > 0 ? 'Make it yours.' : 'Your first deck.'}</h1>
      <p className="onboarding-intro">Make your own, or bring one from Anki.</p>
      <DeckEntryChoices disabled={!ready || busy} importing={busyAction === 'import'} onCreate={startCreation} onImport={() => { void onImportDeck(); }} />
      <button type="button" className="onboarding-tutorial" onClick={() => { void onTrySample(); }} disabled={!ready || busy}>
        <span>{busyAction === 'sample' ? 'Opening…' : 'Quick start'}<small>5 tutorial cards</small></span><UiIcon name="arrow" />
      </button>
    </section> : <section className="onboarding-demo" aria-labelledby="onboarding-heading">
      <div className="onboarding-demo-intro">
        <h1 ref={heading} id="onboarding-heading" tabIndex={-1}>{step === 'question' ? 'Try one card.' : 'How did you do?'}</h1>
        <p className="onboarding-intro">{step === 'question' ? 'Think first. Then tap the eye.' : 'Rate what you remembered.'}</p>
      </div>
      <div className="onboarding-example" aria-live="polite" aria-atomic="true">
        {step === 'question' ? <p>What do you call a group<br />of flashcards?</p> : <><p className="onboarding-example-answer">A deck.</p><p className="onboarding-example-note">Forgot? Choose Again.<br />It will come back sooner.</p></>}
      </div>
      {step === 'question' ? <button type="button" className="onboarding-reveal" aria-label="Show answer" onClick={reveal}>
        <EyeGlyph variant="aureole" halo="oval" idle />
      </button> : <div className="onboarding-ratings" role="group" aria-label="How well did you remember?">
        {RATINGS.map(({ rating, label, meaning }) => <button key={rating} type="button" className={`rating-control${selected === rating ? ' is-feedback' : ''}`} aria-label={`${label}: ${meaning}`} disabled={pending} onClick={() => choose(rating)}>
          <RatingGlyph rating={rating} /><span className="rating-label">{label}</span><span className="onboarding-rating-meaning">{meaning}</span>
        </button>)}
      </div>}
    </section>}
    <div className="onboarding-notices">
      {error && <p className="deck-entry-error" role="alert">{error}</p>}
      {!ready && !error && <p className="deck-entry-loading" role="status">Getting Kit ready…</p>}
    </div>
  </main>;
}
