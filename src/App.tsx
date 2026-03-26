import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { ThemeProvider } from './components/ThemeProvider';
import { useDatabase } from './hooks/useDatabase';
import { useBackup } from './hooks/useBackup';
import { PixelCat } from './components/PixelCat';
import Home from './pages/Home';

// Lazy-loaded pages — keeps KaTeX, Konva, and other heavy deps out of the
// initial chunk so the WKWebView doesn't OOM during database init.
const Study = lazy(() => import('./pages/Study'));
const Browse = lazy(() => import('./pages/Browse'));
const Settings = lazy(() => import('./pages/Settings'));
const DeckStats = lazy(() => import('./pages/DeckStats'));
const DeckSettings = lazy(() => import('./pages/DeckSettings'));
const TagBrowser = lazy(() => import('./pages/TagBrowser'));

// ---------------------------------------------------------------------------
// Route state
// ---------------------------------------------------------------------------

type Route =
  | { page: 'home' }
  | { page: 'study'; deckId: string; deckName: string }
  | { page: 'browse'; deckId: string; deckName: string }
  | { page: 'stats'; deckId: string; deckName: string }
  | { page: 'deck-settings'; deckId: string; deckName: string }
  | { page: 'settings' }
  | { page: 'tags'; deckId?: string; deckName?: string };

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
        <p className="text-sm text-[#C4C4C4] leading-relaxed">
          Kit is a flashcard app that uses spaced repetition to help you
          remember anything. Import your Anki .apkg decks and study on the go.
        </p>
        <div className="flex flex-col gap-2 text-xs text-[#C4C4C4] leading-relaxed">
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
        <p className="text-sm text-[#C4C4C4] text-center">
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
          className="w-full py-3 text-sm text-[#C4C4C4] active:text-[#1c1c1e] dark:active:text-[#E5E5E5] transition-colors"
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

  const goTags = useCallback((deckId?: string, deckName?: string) => {
    setRoute({
      page: 'tags',
      ...(deckId !== undefined ? { deckId } : {}),
      ...(deckName !== undefined ? { deckName } : {}),
    });
  }, []);

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

  const pageFallback = (
    <div className="min-h-[100dvh] bg-[var(--kit-bg)] flex items-center justify-center">
      <p className="text-sm text-[#C4C4C4]">Loading…</p>
    </div>
  );

  if (route.page === 'study') {
    return (
      <Suspense fallback={pageFallback}>
        <Study
          db={db}
          deckId={route.deckId}
          deckName={route.deckName}
          onExit={goHome}
        />
      </Suspense>
    );
  }

  if (route.page === 'browse') {
    return (
      <Suspense fallback={pageFallback}>
        <Browse
          db={db}
          deckId={route.deckId}
          deckName={route.deckName}
          onBack={goHome}
        />
      </Suspense>
    );
  }

  if (route.page === 'stats') {
    return (
      <Suspense fallback={pageFallback}>
        <DeckStats
          db={db}
          deckId={route.deckId}
          deckName={route.deckName}
          onBack={goHome}
        />
      </Suspense>
    );
  }

  if (route.page === 'deck-settings') {
    return (
      <Suspense fallback={pageFallback}>
        <DeckSettings
          db={db}
          deckId={route.deckId}
          deckName={route.deckName}
          onBack={goHome}
        />
      </Suspense>
    );
  }

  if (route.page === 'settings') {
    return (
      <Suspense fallback={pageFallback}>
        <Settings db={db} onBack={goHome} />
      </Suspense>
    );
  }

  if (route.page === 'tags') {
    return (
      <Suspense fallback={pageFallback}>
        <TagBrowser
          db={db}
          {...(route.deckId !== undefined ? { deckId: route.deckId } : {})}
          {...(route.deckName !== undefined ? { deckName: route.deckName } : {})}
          onBack={goHome}
        />
      </Suspense>
    );
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
      onTags={goTags}
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
