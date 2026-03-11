import { useState } from 'react';
import { ThemeProvider } from './components/ThemeProvider';
import { useTheme } from './hooks/useTheme';
import { useDatabase } from './hooks/useDatabase';
import { seedDemoData } from './lib/db/seed';
import Study from './pages/Study';

const DEMO_DECK_ID = 'demo-deck-00000000-0000-0000-0000-000000000000';

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  return (
    <button
      onClick={toggleTheme}
      className="px-3 py-1.5 text-sm border border-border-dark dark:border-border-dark text-text-light dark:text-text-dark bg-surface-light dark:bg-surface-dark rounded"
    >
      {theme === 'dark' ? 'Light' : 'Dark'}
    </button>
  );
}

function AppInner() {
  const { db, loading: dbLoading, error: dbError } = useDatabase();
  const [studyDeckId, setStudyDeckId] = useState<string | null>(null);
  const [seedError, setSeedError] = useState('');

  function openDemo() {
    if (!db) return;
    const result = seedDemoData(db);
    if (!result.success) {
      setSeedError(result.error);
      return;
    }
    setStudyDeckId(result.deckId);
  }

  if (studyDeckId) {
    return (
      <Study
        db={db}
        deckId={studyDeckId}
        deckName="Medical Sciences"
        onExit={() => setStudyDeckId(null)}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#FAFAFA] dark:bg-[#0A0A0A] text-[#171717] dark:text-[#E5E5E5] font-mono">
      <div className="p-8 flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold tracking-widest uppercase">Kit</span>
          <ThemeToggle />
        </div>

        <div className="border border-[#E5E5E5] dark:border-[#262626] bg-white dark:bg-[#141414] p-6 rounded-md flex flex-col gap-3">
          <p className="text-sm text-[#737373]">
            {dbLoading ? 'Initialising database…' : 'Database ready'}
          </p>

          {dbError && (
            <p className="text-xs text-red-500">{dbError}</p>
          )}
          {seedError && (
            <p className="text-xs text-red-500">{seedError}</p>
          )}

          <button
            disabled={dbLoading || !!dbError}
            onClick={openDemo}
            className="px-4 py-2 text-sm border border-[#E5E5E5] dark:border-[#262626] rounded-md text-[#171717] dark:text-[#E5E5E5] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {dbLoading ? 'Loading…' : 'Open Study (demo)'}
          </button>
        </div>
      </div>
    </div>
  );
}

function App() {
  return (
    <ThemeProvider>
      <AppInner />
    </ThemeProvider>
  );
}

export default App;
