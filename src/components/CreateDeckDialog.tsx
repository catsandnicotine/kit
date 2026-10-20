import { useState } from 'react';

interface CreateDeckDialogProps {
  creating: boolean;
  error: string | null;
  onCreate: (name: string) => void;
  onCancel: () => void;
}

/**
 * Ask for a deck name before creating an empty deck.
 *
 * @param props - Dialog state and action callbacks.
 * @returns A modal deck-name form.
 */
export function CreateDeckDialog({ creating, error, onCreate, onCancel }: CreateDeckDialogProps) {
  const [name, setName] = useState('');

  return (
    <div className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center px-6" role="dialog" aria-modal="true" aria-labelledby="create-deck-title">
      <form
        className="w-full max-w-sm rounded-2xl bg-[#FDFBF7] dark:bg-[#1A1A1A] p-5 shadow-2xl"
        onSubmit={event => {
          event.preventDefault();
          const trimmed = name.trim();
          if (trimmed && !creating) onCreate(trimmed);
        }}
      >
        <h2 id="create-deck-title" className="text-lg font-semibold">Create a deck</h2>
        <label htmlFor="new-deck-name" className="sr-only">
          Deck name
        </label>
        <input
          id="new-deck-name"
          autoFocus
          value={name}
          onChange={event => setName(event.target.value)}
          placeholder="Deck name"
          maxLength={80}
          disabled={creating}
          className="mt-5 w-full px-4 py-3 text-base bg-[var(--kit-surface)] rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-[#8E8E93] disabled:opacity-60"
        />
        {error && <p className="mt-3 text-xs text-red-500" role="alert">{error}</p>}
        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={creating}
            className="flex-1 py-3 text-sm text-[#6B6B6B] dark:text-[#A3A3A3] rounded-xl disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={creating || !name.trim()}
            className="flex-1 py-3 text-sm font-semibold rounded-xl bg-[#1c1c1e] dark:bg-[#E5E5E5] text-white dark:text-[#0A0A0A] disabled:opacity-40"
          >
            {creating ? 'Creating…' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  );
}
