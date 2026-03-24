import { useCallback, useEffect, useState } from 'react';
import { ThemeProvider } from './components/ThemeProvider';
import { useDatabase } from './hooks/useDatabase';
import { useBackup } from './hooks/useBackup';
import { PixelCat } from './components/PixelCat';
import Home from './pages/Home';
import Study from './pages/Study';
import Browse from './pages/Browse';
import Settings from './pages/Settings';
import DeckStats from './pages/DeckStats';
import DeckSettings from './pages/DeckSettings';

// ---------------------------------------------------------------------------
// Route state
// ---------------------------------------------------------------------------

type Route =
  | { page: 'home' }
  | { page: 'study'; deckId: string; deckName: string }
  | { page: 'browse'; deckId: string; deckName: string }
  | { page: 'stats'; deckId: string; deckName: string }
  | { page: 'deck-settings'; deckId: string; deckName: string }
  | { page: 'settings' };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LS_ONBOARDED_KEY = 'kit_onboarded';

// ---------------------------------------------------------------------------
// Onboarding screen
// ---------------------------------------------------------------------------

function Onboarding({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div
      className="min-h-screen bg-[var(--kit-bg)] text-[#1c1c1e] dark:text-[#E5E5E5] flex items-center justify-center"
      style={{
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
        paddingLeft: 'max(1.5rem, env(safe-area-inset-left))',
        paddingRight: 'max(1.5rem, env(safe-area-inset-right))',
      }}
    >
      <div className="max-w-sm w-full flex flex-col items-center gap-6 text-center">
        <PixelCat size={96} />
        <h1 className="text-xl font-semibold">Welcome to Kit</h1>
        <p className="text-sm text-[#737373] leading-relaxed">
          Kit is a flashcard app that uses spaced repetition to help you
          remember anything. Import your Anki .apkg decks and study on the go.
        </p>
        <div className="flex flex-col gap-2 text-xs text-[#A3A3A3] leading-relaxed">
          <p>1. Tap <strong className="text-[#1c1c1e] dark:text-[#E5E5E5]">Import Deck</strong> to add an .apkg file</p>
          <p>2. Tap a deck to start studying</p>
          <p>3. Rate each card and Kit schedules your reviews</p>
        </div>
        <button
          onClick={onDismiss}
          className="w-full py-3 text-sm font-semibold bg-[#1c1c1e] dark:bg-[#E5E5E5] text-white dark:text-[#0A0A0A] rounded-lg active:opacity-80 transition-opacity mt-2"
        >
          Get Started
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// iCloud restore prompt
// ---------------------------------------------------------------------------

function ICloudRestorePrompt({
  cardCount,
  timestamp,
  onRestore,
  onSkip,
}: {
  cardCount: number;
  timestamp: number;
  onRestore: () => void;
  onSkip: () => void;
}) {
  const date = new Date(timestamp * 1000);
  const formatted = date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <div
      className="min-h-screen bg-[var(--kit-bg)] text-[#1c1c1e] dark:text-[#E5E5E5] flex items-center justify-center"
      style={{
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
        paddingLeft: 'max(1.5rem, env(safe-area-inset-left))',
        paddingRight: 'max(1.5rem, env(safe-area-inset-right))',
      }}
    >
      <div className="max-w-sm w-full bg-[var(--kit-surface)] border border-[#E5E5E5] dark:border-[#262626] rounded-xl p-6 flex flex-col gap-4">
        <h2 className="text-base font-semibold text-center">iCloud Backup Found</h2>
        <p className="text-sm text-[#737373] text-center">
          A backup with {cardCount} {cardCount === 1 ? 'card' : 'cards'} from {formatted} was
          found in iCloud Drive. Would you like to restore it?
        </p>
        <button
          onClick={onRestore}
          className="w-full py-3 text-sm font-semibold bg-[#1c1c1e] dark:bg-[#E5E5E5] text-white dark:text-[#0A0A0A] rounded-lg active:opacity-80 transition-opacity"
        >
          Restore Backup
        </button>
        <button
          onClick={onSkip}
          className="w-full py-3 text-sm text-[#737373] active:text-[#1c1c1e] dark:active:text-[#E5E5E5] transition-colors"
        >
          Start Fresh
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// App inner (has access to theme context)
// ---------------------------------------------------------------------------

function AppInner() {
  const {
    db,
    loading: dbLoading,
    error: dbError,
    icloudBackupAvailable,
    acceptRestore,
    declineRestore,
  } = useDatabase();

  // Initialize the backup system — sets up the module-level _backupDb reference
  // so that scheduleICloudBackup() works from any hook.
  useBackup(db);

  const [route, setRoute] = useState<Route>({ page: 'home' });
  const [showOnboarding, setShowOnboarding] = useState(false);

  // Check if this is the first launch
  useEffect(() => {
    try {
      if (!localStorage.getItem(LS_ONBOARDED_KEY)) {
        setShowOnboarding(true);
      }
    } catch {
      // localStorage unavailable — skip onboarding.
    }
  }, []);

  const dismissOnboarding = useCallback(() => {
    setShowOnboarding(false);
    try {
      localStorage.setItem(LS_ONBOARDED_KEY, '1');
    } catch {
      // Best effort.
    }
  }, []);

  const goHome = useCallback(() => setRoute({ page: 'home' }), []);

  const goStudy = useCallback((deckId: string, deckName: string) => {
    setRoute({ page: 'study', deckId, deckName });
  }, []);

  const goBrowse = useCallback((deckId: string, deckName: string) => {
    setRoute({ page: 'browse', deckId, deckName });
  }, []);

  const goStats = useCallback((deckId: string, deckName: string) => {
    setRoute({ page: 'stats', deckId, deckName });
  }, []);

  const goDeckSettings = useCallback((deckId: string, deckName: string) => {
    setRoute({ page: 'deck-settings', deckId, deckName });
  }, []);

  const goSettings = useCallback(() => setRoute({ page: 'settings' }), []);

  // ── Onboarding (first launch) ────────────────────────────────────────
  if (showOnboarding) {
    return <Onboarding onDismiss={dismissOnboarding} />;
  }

  // ── iCloud restore prompt (first launch only) ────────────────────────
  if (icloudBackupAvailable && !db) {
    return (
      <ICloudRestorePrompt
        cardCount={icloudBackupAvailable.cardCount}
        timestamp={icloudBackupAvailable.timestamp}
        onRestore={acceptRestore}
        onSkip={declineRestore}
      />
    );
  }

  if (route.page === 'study') {
    return (
      <Study
        db={db}
        deckId={route.deckId}
        deckName={route.deckName}
        onExit={goHome}
      />
    );
  }

  if (route.page === 'browse') {
    return (
      <Browse
        db={db}
        deckId={route.deckId}
        deckName={route.deckName}
        onBack={goHome}
      />
    );
  }

  if (route.page === 'stats') {
    return (
      <DeckStats
        db={db}
        deckId={route.deckId}
        deckName={route.deckName}
        onBack={goHome}
      />
    );
  }

  if (route.page === 'deck-settings') {
    return (
      <DeckSettings
        db={db}
        deckId={route.deckId}
        deckName={route.deckName}
        onBack={goHome}
      />
    );
  }

  if (route.page === 'settings') {
    return <Settings db={db} onBack={goHome} />;
  }

  return (
    <Home
      db={db}
      dbLoading={dbLoading}
      dbError={dbError}
      onStudy={goStudy}
      onBrowse={goBrowse}
      onStats={goStats}
      onDeckSettings={goDeckSettings}
      onSettings={goSettings}
    />
  );
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

function App() {
  return (
    <ThemeProvider>
      <AppInner />
    </ThemeProvider>
  );
}

export default App;
