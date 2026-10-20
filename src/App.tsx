import { type ReactNode, lazy, startTransition, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ThemeProvider } from './components/ThemeProvider';
import { useDeckManager } from './hooks/useDeckManager';
import { useSync } from './hooks/useSync';
import { useConnectivity } from './hooks/useConnectivity';
import { useConnectionNotice } from './hooks/useConnectionNotice';
import { SyncNotice } from './components/SyncNotice';
import { useICloudAvailability } from './hooks/useICloudAvailability';
import { Onboarding } from './components/Onboarding';
import type { OnboardingAction } from './components/Onboarding';
import Home from './pages/Home';
import { App as CapApp } from '@capacitor/app';
import { isApkgFileUrl, readFileFromUrl } from './lib/platform/fileOpener';
import type { Database } from 'sql.js';
import type { EditOp } from './lib/sync/types';
import { createEmptyDeckSnapshot } from './lib/db/deckFactory';
import { createWelcomeDeckSnapshot, WELCOME_DECK_ID } from './lib/db/welcomeDeck';
import { pickApkgFile } from './lib/platform/filePicker';
import { hapticNavigate, hapticSuccess, hapticTap } from './lib/platform/haptics';

// Lazy-loaded pages — keeps KaTeX, Konva, and other heavy deps out of the
// initial chunk so the WKWebView doesn't OOM during database init.
const loadStudy = () => import('./pages/Study');
const Study = lazy(loadStudy);
const loadBrowse = () => import('./pages/Browse');
const Browse = lazy(loadBrowse);
const loadSettings = () => import('./pages/Settings');
const Settings = lazy(loadSettings);
const loadDeckStats = () => import('./pages/DeckStats');
const DeckStats = lazy(loadDeckStats);
const loadDeckSettings = () => import('./pages/DeckSettings');
const DeckSettings = lazy(loadDeckSettings);
const loadTagBrowser = () => import('./pages/TagBrowser');
const TagBrowser = lazy(loadTagBrowser);
const loadReviewStudy = () => import('./pages/ReviewStudy');
const ReviewStudy = lazy(loadReviewStudy);

// ---------------------------------------------------------------------------
// Route state
// ---------------------------------------------------------------------------

type Route =
  | { page: 'home' }
  | { page: 'study'; deckId: string; deckName: string }
  | { page: 'review-study'; deckId: string; deckName: string }
  | { page: 'browse'; deckId: string; deckName: string; guideFirstCard?: boolean }
  | { page: 'stats'; deckId: string; deckName: string }
  | { page: 'deck-settings'; deckId: string; deckName: string }
  | { page: 'settings'; scrollTo?: string | undefined }
  | { page: 'tags' };

export type AppMode = 'learn' | 'review';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LS_ONBOARDED_KEY = 'kit_onboarded';

// ---------------------------------------------------------------------------
// App inner (has access to theme context)
// ---------------------------------------------------------------------------

function AppInner() {
  const deckManager = useDeckManager();
  const { loading, error, deckEntries } = deckManager;

  const [route, setRoute] = useState<Route>({ page: 'home' });
  const [mode, setMode] = useState<AppMode>('learn');
  const [showOnboarding, setShowOnboarding] = useState(() => {
    try {
      return !localStorage.getItem(LS_ONBOARDED_KEY);
    } catch {
      return false;
    }
  });
  const [onboardingBusy, setOnboardingBusy] = useState<OnboardingAction | null>(null);
  const [onboardingError, setOnboardingError] = useState<string | null>(null);
  const navSeqRef = useRef(0);

  // Per-deck database for the currently active deck-scoped page.
  // Opened when navigating to a deck page, closed when returning home.
  const [activeDeckDb, setActiveDeckDb] = useState<Database | null>(null);

  const currentDeckId = 'deckId' in route ? route.deckId : undefined;

  // Real-time iCloud sync — watches for edits from other devices.
  const { status: syncStatus, lastSyncedAt, progress: syncProgress, syncAll } = useSync(
    loading ? null : deckManager,
    currentDeckId,
  );

  // One source of truth for iCloud availability — used by Home chip + Settings.
  const icloudAvailability = useICloudAvailability();
  const online = useConnectivity();
  const connectionNotice = useConnectionNotice(online, icloudAvailability, syncStatus, route.page === 'home' && !showOnboarding);

  // File opened via iOS "Open in" / share sheet / Files tap
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  useEffect(() => {
    const listener = CapApp.addListener('appUrlOpen', async ({ url }) => {
      if (!isApkgFileUrl(url)) return;
      const file = await readFileFromUrl(url);
      if (file) setPendingFile(file);
    });
    return () => { listener.then(h => h.remove()); };
  }, []);

  const clearPendingFile = useCallback(() => setPendingFile(null), []);

  const markOnboarded = useCallback(() => {
    setShowOnboarding(false);
    try {
      localStorage.setItem(LS_ONBOARDED_KEY, '1');
    } catch {
      // Best effort.
    }
  }, []);

  const dismissOnboarding = useCallback(() => {
    hapticTap();
    markOnboarded();
  }, [markOnboarded]);

  const finalizeDeck = useCallback((deckId: string) => {
    deckManager.refreshCounts(deckId);
    deckManager.compact(deckId).catch(() => {});
    deckManager.saveRegistry().catch(() => {});
  }, [deckManager]);

  const goHome = useCallback(() => {
    navSeqRef.current++; // Cancel any in-flight navigateToDeck
    if (currentDeckId) {
      finalizeDeck(currentDeckId);
    }
    setActiveDeckDb(null);
    setRoute({ page: 'home' });
    deckManager.refreshDecks();
  }, [currentDeckId, deckManager, finalizeDeck]);

  const navigateToDeck = useCallback(
    (page: Route['page'], deckId: string, deckName: string, guideFirstCard = false) => {
      const seq = ++navSeqRef.current;

      // Keep the current screen until both its replacement and database are ready.
      const loaders = { study: loadStudy, 'review-study': loadReviewStudy, browse: loadBrowse, stats: loadDeckStats, 'deck-settings': loadDeckSettings };
      const loadPage = loaders[page as keyof typeof loaders];
      Promise.all([deckManager.openDeckDb(deckId), loadPage?.()]).then(([db]) => {
        if (seq !== navSeqRef.current || !db) return;
        startTransition(() => {
          setActiveDeckDb(db);
          if (page === 'browse') setRoute({ page, deckId, deckName, guideFirstCard });
          else setRoute({ page, deckId, deckName } as Route);
        });
      }).catch(() => {
        // DeckManager marks failed decks so Home can offer recovery.
        deckManager.refreshDecks();
      });
    },
    [deckManager],
  );

  const goStudy = useCallback(
    (deckId: string, deckName: string) => navigateToDeck('study', deckId, deckName),
    [navigateToDeck],
  );

  const goReviewStudy = useCallback(
    (deckId: string, deckName: string) => navigateToDeck('review-study', deckId, deckName),
    [navigateToDeck],
  );

  const goBrowse = useCallback(
    (deckId: string, deckName: string, guideFirstCard = false) => (
      navigateToDeck('browse', deckId, deckName, guideFirstCard)
    ),
    [navigateToDeck],
  );

  const goStats = useCallback(
    (deckId: string, deckName: string) => navigateToDeck('stats', deckId, deckName),
    [navigateToDeck],
  );

  const goSettings = useCallback((scrollTo?: string) => { void loadSettings().then(() => startTransition(() => setRoute({ page: 'settings', scrollTo }))); }, []);
  const goTags = useCallback(() => { void loadTagBrowser().then(() => startTransition(() => setRoute({ page: 'tags' }))); }, []);

  const goDeckSettings = useCallback(
    (deckId: string, deckName: string) => navigateToDeck('deck-settings', deckId, deckName),
    [navigateToDeck],
  );

  const handleSessionComplete = useCallback(() => {
    if (currentDeckId) finalizeDeck(currentDeckId);
  }, [currentDeckId, finalizeDeck]);
  const handleSyncEdit = useMemo(() => {
    if (!currentDeckId) return undefined;
    return (ops: EditOp[]) => {
      deckManager.writeEdit(currentDeckId, ops).catch(() => {});
    };
  }, [currentDeckId, deckManager]);

  const handleTrySample = useCallback(async () => {
    if (loading || onboardingBusy) return;
    setOnboardingBusy('sample');
    setOnboardingError(null);
    try {
      const snapshot = createWelcomeDeckSnapshot();
      const db = deckEntries.some(entry => entry.deckId === WELCOME_DECK_ID)
        ? await deckManager.openDeckDb(snapshot.deckId)
        : await deckManager.createFromSnapshot(snapshot);
      if (!db) throw new Error('Kit could not prepare the sample deck.');
      await deckManager.saveRegistry();
      deckManager.refreshDecks();
      hapticSuccess();
      setMode('learn');
      await loadStudy();
      startTransition(() => {
        markOnboarded();
        setActiveDeckDb(db);
        setRoute({ page: 'study', deckId: snapshot.deckId, deckName: snapshot.deck.name });
      });
    } catch (cause) {
      setOnboardingError(cause instanceof Error ? cause.message : 'Could not create the sample deck.');
    } finally {
      setOnboardingBusy(null);
    }
  }, [loading, onboardingBusy, deckEntries, deckManager, markOnboarded]);

  const handleCreateFirstDeck = useCallback(async (name: string) => {
    if (loading || onboardingBusy) return;
    setOnboardingBusy('create');
    setOnboardingError(null);
    try {
      const snapshot = createEmptyDeckSnapshot(name);
      const db = await deckManager.createFromSnapshot(snapshot);
      if (!db) throw new Error('Kit could not create that deck.');
      await deckManager.saveRegistry();
      deckManager.refreshDecks();
      hapticSuccess();
      setMode('learn');
      await loadBrowse();
      startTransition(() => {
        markOnboarded();
        setActiveDeckDb(db);
        setRoute({
        page: 'browse',
        deckId: snapshot.deckId,
        deckName: snapshot.deck.name,
        guideFirstCard: true,
        });
      });
    } catch (cause) {
      setOnboardingError(cause instanceof Error ? cause.message : 'Could not create that deck.');
    } finally {
      setOnboardingBusy(null);
    }
  }, [loading, onboardingBusy, deckManager, markOnboarded]);

  const handleImportFirstDeck = useCallback(async () => {
    if (onboardingBusy) return;
    setOnboardingBusy('import');
    setOnboardingError(null);
    try {
      hapticNavigate();
      const file = await pickApkgFile();
      if (!file) return;
      setPendingFile(file);
      markOnboarded();
      setRoute({ page: 'home' });
    } catch (cause) {
      setOnboardingError(cause instanceof Error ? cause.message : 'Could not open that file.');
    } finally {
      setOnboardingBusy(null);
    }
  }, [onboardingBusy, markOnboarded]);

  const withStatus = (content: ReactNode) => <>
    <Suspense fallback={<div className="min-h-[100dvh] bg-[var(--kit-bg)]" aria-busy="true" />}>{content}</Suspense>
  </>;

  // ── Onboarding (first launch) ────────────────────────────────────────
  if (showOnboarding) {
    return withStatus(
      <Onboarding
        ready={!loading && !error}
        existingDeckCount={deckEntries.length}
        busyAction={onboardingBusy}
        error={onboardingError ?? (error || null)}
        onTrySample={handleTrySample}
        onCreateDeck={handleCreateFirstDeck}
        onImportDeck={handleImportFirstDeck}
        onDismiss={dismissOnboarding}
      />
    );
  }

  if (route.page === 'study') {
    return withStatus(
        <Study
          db={activeDeckDb}
          deckId={route.deckId}
          deckName={route.deckName}
          onExit={goHome}
          onSyncEdit={handleSyncEdit}
          onSessionComplete={handleSessionComplete}
        />
    );
  }

  if (route.page === 'review-study') {
    return withStatus(
        <ReviewStudy
          db={activeDeckDb}
          deckId={route.deckId}
          deckName={route.deckName}
          onExit={goHome}
        />
    );
  }

  if (route.page === 'browse') {
    return withStatus(
        <Browse
          db={activeDeckDb}
          deckId={route.deckId}
          deckName={route.deckName}
          onBack={goHome}
          guideFirstCard={route.guideFirstCard ?? false}
          onStartStudy={() => goStudy(route.deckId, route.deckName)}
          onSyncEdit={handleSyncEdit}
        />
    );
  }

  if (route.page === 'stats') {
    return withStatus(
        <DeckStats
          db={activeDeckDb}
          deckId={route.deckId}
          deckName={route.deckName}
          onBack={goHome}
        />
    );
  }

  if (route.page === 'deck-settings') {
    return withStatus(
        <DeckSettings
          db={activeDeckDb}
          deckId={route.deckId}
          deckName={route.deckName}
          onBack={goHome}
          onSyncEdit={handleSyncEdit}
        />
    );
  }

  if (route.page === 'settings') {
    return withStatus(
        <Settings
          deckManager={loading ? null : deckManager}
          lastSyncedAt={lastSyncedAt}
              icloudAvailability={icloudAvailability}
          onBack={goHome}
          onSync={syncAll}
          onOpenDeck={goBrowse}
          scrollTo={route.scrollTo}
        />
    );
  }

  if (route.page === 'tags') {
    return withStatus(
        <TagBrowser
          deckManager={deckManager}
          onBack={goHome}
        />
    );
  }

  return withStatus(
    <Home
      connectionNotice={<SyncNotice visible={connectionNotice.visible} kind={connectionNotice.kind} progress={syncProgress} onDismiss={connectionNotice.dismiss} />}
      db={null}
      dbLoading={loading}
      dbError={error}
      deckEntries={deckEntries}
      deckManager={deckManager}
      mode={mode}
      onModeChange={setMode}
      onStudy={goStudy}
      onReviewStudy={goReviewStudy}
      onBrowse={goBrowse}
      onStats={goStats}
      onSettings={goSettings}
      onTags={goTags}
      onDeckSettings={goDeckSettings}
      pendingFile={pendingFile}
      onPendingFileConsumed={clearPendingFile}
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
