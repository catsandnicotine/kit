import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { ThemeProvider } from './components/ThemeProvider';
import { useDeckManager } from './hooks/useDeckManager';
import type { UseDeckManagerReturn } from './hooks/useDeckManager';
import { useSync } from './hooks/useSync';
import type { SyncStatus } from './hooks/useSync';
import { PixelCat } from './components/PixelCat';
import Home from './pages/Home';
import type { Database } from 'sql.js';
import type { EditOp } from './lib/sync/types';

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
// App inner (has access to theme context)
// ---------------------------------------------------------------------------

function AppInner() {
  const deckManager = useDeckManager();
  const { loading, error, deckEntries } = deckManager;

  const [route, setRoute] = useState<Route>({ page: 'home' });
  const [showOnboarding, setShowOnboarding] = useState(false);

  // Per-deck database for the currently active deck-scoped page.
  // Opened when navigating to a deck page, closed when returning home.
  const [activeDeckDb, setActiveDeckDb] = useState<Database | null>(null);

  // Real-time iCloud sync — watches for edits from other devices.
  const currentDeckIdForSync = 'deckId' in route ? route.deckId : undefined;
  const { status: syncStatus } = useSync(
    loading ? null : deckManager,
    currentDeckIdForSync,
  );

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

  const goHome = useCallback(() => {
    // Close the active deck DB when returning home
    if (route.page !== 'home' && 'deckId' in route && route.deckId) {
      // Refresh cached counts before leaving the deck
      deckManager.refreshCounts(route.deckId);
      // Compact edit files before leaving the deck
      deckManager.compact(route.deckId).catch(() => {});
      deckManager.saveRegistry().catch(() => {});
    }
    setActiveDeckDb(null);
    setRoute({ page: 'home' });
    // Refresh deck list in case counts changed
    deckManager.refreshDecks().catch(() => {});
  }, [route, deckManager]);

  const navigateToDeck = useCallback(
    async (page: Route['page'], deckId: string, deckName: string) => {
      // Open the per-deck database
      const db = await deckManager.openDeckDb(deckId);
      setActiveDeckDb(db);
      setRoute({ page, deckId, deckName } as Route);
    },
    [deckManager],
  );

  const goStudy = useCallback(
    (deckId: string, deckName: string) => navigateToDeck('study', deckId, deckName),
    [navigateToDeck],
  );

  const goBrowse = useCallback(
    (deckId: string, deckName: string) => navigateToDeck('browse', deckId, deckName),
    [navigateToDeck],
  );

  const goStats = useCallback(
    (deckId: string, deckName: string) => navigateToDeck('stats', deckId, deckName),
    [navigateToDeck],
  );

  const goSettings = useCallback(() => setRoute({ page: 'settings' }), []);

  const goTags = useCallback(async (deckId?: string, deckName?: string) => {
    if (deckId) {
      const db = await deckManager.openDeckDb(deckId);
      setActiveDeckDb(db);
    }
    setRoute({
      page: 'tags',
      ...(deckId !== undefined ? { deckId } : {}),
      ...(deckName !== undefined ? { deckName } : {}),
    });
  }, [deckManager]);

  const goDeckSettings = useCallback(
    (deckId: string, deckName: string) => navigateToDeck('deck-settings', deckId, deckName),
    [navigateToDeck],
  );

  // ── Compact + save registry when a study session completes ───────────
  const handleSessionComplete = useCallback(() => {
    if ('deckId' in route && route.deckId) {
      deckManager.refreshCounts(route.deckId);
      deckManager.compact(route.deckId).catch(() => {});
      deckManager.saveRegistry().catch(() => {});
    }
  }, [route, deckManager]);

  // ── Sync edit handler for current deck ────────────────────────────────
  const currentDeckId = 'deckId' in route ? route.deckId : undefined;
  const handleSyncEdit = useMemo(() => {
    if (!currentDeckId) return undefined;
    return (ops: EditOp[]) => {
      deckManager.writeEdit(currentDeckId, ops).catch(() => {});
    };
  }, [currentDeckId, deckManager]);

  // ── Onboarding (first launch) ────────────────────────────────────────
  if (showOnboarding) {
    return <Onboarding onDismiss={dismissOnboarding} />;
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
          db={activeDeckDb}
          deckId={route.deckId}
          deckName={route.deckName}
          onExit={goHome}
          onSyncEdit={handleSyncEdit}
          onSessionComplete={handleSessionComplete}
        />
      </Suspense>
    );
  }

  if (route.page === 'browse') {
    return (
      <Suspense fallback={pageFallback}>
        <Browse
          db={activeDeckDb}
          deckId={route.deckId}
          deckName={route.deckName}
          onBack={goHome}
          onSyncEdit={handleSyncEdit}
        />
      </Suspense>
    );
  }

  if (route.page === 'stats') {
    return (
      <Suspense fallback={pageFallback}>
        <DeckStats
          db={activeDeckDb}
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
          db={activeDeckDb}
          deckId={route.deckId}
          deckName={route.deckName}
          onBack={goHome}
          onSyncEdit={handleSyncEdit}
        />
      </Suspense>
    );
  }

  if (route.page === 'settings') {
    return (
      <Suspense fallback={pageFallback}>
        <Settings db={activeDeckDb} onBack={goHome} />
      </Suspense>
    );
  }

  if (route.page === 'tags') {
    return (
      <Suspense fallback={pageFallback}>
        <TagBrowser
          db={activeDeckDb}
          {...(route.deckId !== undefined ? { deckId: route.deckId } : {})}
          {...(route.deckName !== undefined ? { deckName: route.deckName } : {})}
          onBack={goHome}
          onSyncEdit={handleSyncEdit}
        />
      </Suspense>
    );
  }

  return (
    <Home
      db={null}
      dbLoading={loading}
      dbError={error}
      deckEntries={deckEntries}
      deckManager={deckManager}
      syncStatus={syncStatus}
      onStudy={goStudy}
      onBrowse={goBrowse}
      onStats={goStats}
      onSettings={goSettings}
      onTags={goTags}
      onDeckSettings={goDeckSettings}
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
