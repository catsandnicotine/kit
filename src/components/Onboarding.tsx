import { useState } from 'react';

export type OnboardingAction = 'sample' | 'create' | 'import';

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

/**
 * First-run choice screen that gets users to a useful deck quickly.
 *
 * @param props - Readiness state and first-run action callbacks.
 * @returns The onboarding UI.
 */
export function Onboarding({
  ready,
  existingDeckCount,
  busyAction,
  error,
  onTrySample,
  onCreateDeck,
  onImportDeck,
  onDismiss,
}: OnboardingProps) {
  const [creating, setCreating] = useState(false);
  const [deckName, setDeckName] = useState('');
  const busy = busyAction !== null;

  const submitDeck = (event: React.FormEvent) => {
    event.preventDefault();
    const name = deckName.trim();
    if (!name || busy || !ready) return;
    void onCreateDeck(name);
  };

  return (
    <main
      className="min-h-[100dvh] bg-[var(--kit-bg)] text-[#1c1c1e] dark:text-[#E5E5E5] flex items-center justify-center"
      style={{
        paddingTop: 'max(1.5rem, env(safe-area-inset-top))',
        paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))',
        paddingLeft: 'max(1.25rem, env(safe-area-inset-left))',
        paddingRight: 'max(1.25rem, env(safe-area-inset-right))',
      }}
    >
      <div className="max-w-sm w-full flex flex-col items-center text-center">
        <span className="text-2xl font-semibold tracking-widest">KIT</span>

        {creating ? (
          <form onSubmit={submitDeck} className="mt-8 w-full text-left">
            <label htmlFor="first-deck-name" className="block text-xs font-medium text-[#6B6B6B] dark:text-[#A3A3A3] mb-2">
              Deck name
            </label>
            <input
              id="first-deck-name"
              autoFocus
              value={deckName}
              onChange={event => setDeckName(event.target.value)}
              placeholder="e.g. Biology"
              maxLength={80}
              disabled={busy}
              className="w-full px-4 py-3.5 text-base bg-[var(--kit-surface)] rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-[#8E8E93] disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={!ready || busy || !deckName.trim()}
              className="mt-3 w-full py-3.5 text-sm font-semibold bg-[#1c1c1e] dark:bg-[#E5E5E5] text-white dark:text-[#0A0A0A] rounded-xl active:opacity-80 disabled:opacity-40"
            >
              {busyAction === 'create' ? 'Creating…' : 'Create deck'}
            </button>
            <button
              type="button"
              onClick={() => setCreating(false)}
              disabled={busy}
              className="w-full py-3 text-sm text-[#6B6B6B] dark:text-[#A3A3A3] disabled:opacity-40"
            >
              Back
            </button>
          </form>
        ) : (
          <div className="mt-8 w-full flex flex-col gap-3">
            <button
              onClick={() => void onTrySample()}
              disabled={!ready || busy}
              className="w-full rounded-xl bg-[#1c1c1e] dark:bg-[#E5E5E5] text-white dark:text-[#0A0A0A] px-4 py-3.5 text-left active:opacity-80 disabled:opacity-40"
            >
              <span className="block text-sm font-semibold">
                {busyAction === 'sample' ? 'Opening…' : 'Try Kit'}
              </span>
            </button>
            <button
              onClick={() => setCreating(true)}
              disabled={!ready || busy}
              className="w-full rounded-xl bg-[var(--kit-surface)] px-4 py-3.5 text-left active:opacity-70 disabled:opacity-40"
            >
              <span className="block text-sm font-semibold">Create deck</span>
            </button>
            <button
              onClick={() => void onImportDeck()}
              disabled={!ready || busy}
              className="w-full rounded-xl bg-[var(--kit-surface)] px-4 py-3.5 text-left active:opacity-70 disabled:opacity-40"
            >
              <span className="block text-sm font-semibold">
                {busyAction === 'import' ? 'Opening Files…' : 'Import an Anki deck'}
              </span>
            </button>
          </div>
        )}

        {!ready && !error && (
          <p className="mt-4 text-xs text-[#6B6B6B] dark:text-[#A3A3A3]" role="status">Getting Kit ready…</p>
        )}
        {error && (
          <p className="mt-4 text-xs text-red-500" role="alert">{error}</p>
        )}
        {!creating && (
          <button
            onClick={onDismiss}
            disabled={busy}
            className="mt-5 px-4 py-2 text-xs text-[#6B6B6B] dark:text-[#A3A3A3] disabled:opacity-40"
          >
            {existingDeckCount > 0
              ? `Continue to my ${existingDeckCount === 1 ? 'deck' : 'decks'}`
              : 'Skip'}
          </button>
        )}
      </div>
    </main>
  );
}
