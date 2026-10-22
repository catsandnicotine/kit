import { HoldEditAction } from '../components/HoldEditAction';
import { useHoldToEdit } from '../hooks/useHoldToEdit';
import { HoldEditFeedback } from '../components/HoldEditFeedback';
import { CardTagRow } from '../components/CardTagRow';
import { CardScrollFrame } from '../components/CardScrollFrame';
import { CardTurnFrame } from '../components/CardTurnFrame';
import { useCardTurn } from '../hooks/useCardTurn';
import { useCardSeen } from '../hooks/useCardSeen';
import { CardSeenNotice } from '../components/CardSeenNotice';
import { useStudyVideoMedia } from '../hooks/useStudyVideoMedia';
import type { CardFace } from '../types/editorUi';
import { ModeAtmosphere } from '../components/ModeAtmosphere';
import { StudyFooter } from '../components/StudyFooter';
import { UiIcon } from '../components/UiIcon';
import { SessionFinish } from '../components/SessionFinish';
import { usePracticeDeck } from '../hooks/usePracticeDeck';
import { DeckName } from '../components/DeckName';
import { StudyProgressBar } from '../components/StudyProgressBar';
/**
 * Study page — full-screen spaced-repetition study view.
 *
 * Layout:
 *  ┌──────────────────────────┐
 *  │  header: deck name + stats│
 *  │  progress bar            │
 *  ├──────────────────────────┤
 *  │                          │
 *  │   card content (tap area)│
 *  │                          │
 *  ├──────────────────────────┤
 *  │  rating buttons / prompt │
 *  └──────────────────────────┘
 */

import { ShowAnswerButton } from '../components/ShowAnswerButton';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Database } from 'sql.js';
import { RatingGlyph } from '../components/RatingGlyph';
import type { Card, Rating } from '../types';
import { useStudySession } from '../hooks/useStudySession';
import { useChoiceFeedback } from '../hooks/useChoiceFeedback';
import { ReviewPassView } from '../components/ReviewPassView';
import { useDeckMedia } from '../hooks/useDeckMedia';
import { useTheme } from '../hooks/useTheme';
import { hapticTap } from '../lib/platform/haptics';
import { getDeckStats, getTagsForDeck, type TagCount } from '../lib/db/queries';
import { renderImageOcclusion } from '../lib/imageOcclusion';
import { renderMath } from '../lib/renderMath';
import { CardEditor } from '../components/CardEditor';
import { renderLegacyCardHints } from '../lib/cardHints';
import { useSessionEntrance } from '../hooks/useSessionEntrance';
import type { DeckMediaBootstrap } from '../types/deckMedia';
import '../components/SessionEntrance.css';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface StudyProps {
  db: Database | null;
  deckId: string;
  deckName?: string;
  mediaBootstrap?: DeckMediaBootstrap | null;
  onExit?: () => void;
  /** Callback to emit sync edit operations (new per-deck architecture). */
  onSyncEdit?: ((ops: import('../lib/sync/types').EditOp[]) => void) | undefined;
  /** Called when the study session completes (all cards reviewed). */
  onSessionComplete?: () => void;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------


/**
 * Format a scheduled interval in days to a human-readable short string.
 *
 * @param days - Interval in days.
 * @returns Formatted string like "<1m", "10m", "1h", "1d", "3d", "2w", "2mo".
 */
function formatInterval(days: number): string {
  const minutes = days * 24 * 60;
  if (minutes < 1) return '<1m';
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.round(hours)}h`;
  if (days < 14) return `${Math.round(days)}d`;
  const weeks = days / 7;
  if (weeks < 8) return `${Math.round(weeks)}w`;
  const months = days / 30;
  return `${Math.round(months)}mo`;
}

/** Format a scheduled interval for assistive technology. */
function formatIntervalForSpeech(days: number): string {
  const minutes = days * 24 * 60;
  if (minutes < 1) return 'in less than a minute';
  if (minutes < 60) {
    const rounded = Math.round(minutes);
    return `in ${rounded} ${rounded === 1 ? 'minute' : 'minutes'}`;
  }
  const hours = minutes / 60;
  if (hours < 24) {
    const rounded = Math.round(hours);
    return `in ${rounded} ${rounded === 1 ? 'hour' : 'hours'}`;
  }
  if (days < 14) {
    const rounded = Math.round(days);
    return `in ${rounded} ${rounded === 1 ? 'day' : 'days'}`;
  }
  const weeks = days / 7;
  if (weeks < 8) {
    const rounded = Math.round(weeks);
    return `in ${rounded} ${rounded === 1 ? 'week' : 'weeks'}`;
  }
  const rounded = Math.round(days / 30);
  return `in ${rounded} ${rounded === 1 ? 'month' : 'months'}`;
}

/** Raised controls retain short labels while their pixel symbols carry the hierarchy. */
function RatingButton({ rating, onClick, interval, intervalLabel, selected, disabled }: {
  rating: Rating; onClick: () => void;
  interval?: string | undefined; intervalLabel?: string | undefined;
  selected: boolean; disabled: boolean;
}) {
  const label = rating[0]!.toUpperCase() + rating.slice(1);
  const meaning = { again: 'Forgot', hard: 'With effort', good: 'Remembered', easy: 'Instantly' }[rating];
  return <button type="button" onClick={onClick} disabled={disabled} aria-label={intervalLabel ? `${label}. Card returns ${intervalLabel}.` : label}
    title={meaning} className={`rating-control rating-control--${rating} ${selected ? 'is-feedback' : ''}`}>
    <RatingGlyph rating={rating} /><span className="rating-label">{label}</span>
    <span className="rating-interval" aria-hidden="true">{interval ?? '—'}</span>
  </button>;
}

/**
 * Play an ordered list of audio elements one at a time. The first starts
 * immediately; each subsequent track begins when the previous one ends.
 *
 * @returns Cleanup function that stops playback and removes listeners.
 */
function playAudioSequentially(audios: HTMLAudioElement[]): () => void {
  if (audios.length === 0) return () => {};

  let currentIdx = 0;
  let cancelled = false;
  const cleanups: (() => void)[] = [];

  function playNext() {
    if (cancelled || currentIdx >= audios.length) return;
    const audio = audios[currentIdx];
    if (!audio) return;
    const onEnded = () => {
      currentIdx++;
      playNext();
    };
    audio.addEventListener('ended', onEnded, { once: true });
    cleanups.push(() => audio.removeEventListener('ended', onEnded));

    audio.currentTime = 0;
    audio.play().catch(() => {
      // Autoplay blocked — the user can tap the native controls instead.
      // Still chain to the next so a manual play→end still advances.
    });
  }

  playNext();

  return () => {
    cancelled = true;
    for (const fn of cleanups) fn();
    for (const audio of audios) audio.pause();
  };
}

/**
 * Card content rendered from HTML string.
 *
 * Uses a ref to only update innerHTML when the html prop *value* actually
 * changes — not on every React re-render. This prevents timer-driven
 * re-renders (the 1-second elapsed-time ticker) from tearing down and
 * recreating the DOM, which would restart any in-progress <audio> playback.
 *
 * Audio playback:
 *  - Multiple audio files play sequentially, not simultaneously.
 *  - Only the first track auto-plays; the rest wait for the previous to end.
 *  - A "Replay" button appears when there is audio, letting the user replay
 *    the full sequence.
 *
 * The HTML is wrapped to match Anki's DOM structure:
 *   <div class="night_mode">   ← body-level classes (dark/black modes)
 *     <div class="card">       ← card-level wrapper (deck CSS targets this)
 *       ...content...
 *     </div>
 *   </div>
 *
 * This lets deck CSS rules like `.night_mode .card { ... }` work naturally.
 */
function CardContent({ html, visible, bodyClass, tagLabels }: { html: string; visible: boolean; bodyClass: string; tagLabels?: ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const currentHtmlRef = useRef('');
  const stopPlaybackRef = useRef<(() => void) | null>(null);
  const [hasAudio, setHasAudio] = useState(false);

  /** Collect audio elements from the container in DOM order. */
  const getAudios = useCallback((): HTMLAudioElement[] => {
    const el = containerRef.current;
    if (!el) return [];
    return Array.from(el.querySelectorAll<HTMLAudioElement>('audio'));
  }, []);

  /** Stop any in-progress sequential playback. */
  const stopCurrent = useCallback(() => {
    stopPlaybackRef.current?.();
    stopPlaybackRef.current = null;
  }, []);

  /** Start sequential playback of all audio in this card face. */
  const startPlayback = useCallback(() => {
    stopCurrent();
    const audios = getAudios();
    if (audios.length === 0) return;
    stopPlaybackRef.current = playAudioSequentially(audios);
  }, [getAudios, stopCurrent]);

  // Commit replacement HTML before the browser can paint the previous card.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const outerOpen = bodyClass ? `<div class="${bodyClass}">` : '';
    const outerClose = bodyClass ? '</div>' : '';
    const fullHtml = `${outerOpen}<div class="card">${renderLegacyCardHints(html)}</div>${outerClose}`;
    if (currentHtmlRef.current === fullHtml) return;
    currentHtmlRef.current = fullHtml;

    // Stop & clean up old audio before replacing DOM.
    stopCurrent();
    const oldAudios = el.querySelectorAll<HTMLAudioElement>('audio');
    for (const audio of oldAudios) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }

    el.innerHTML = fullHtml;

    const audios = getAudios();
    setHasAudio(audios.length > 0);

    if (visible && audios.length > 0) {
      stopPlaybackRef.current = playAudioSequentially(audios);
    }

    return stopCurrent;
  }, [html, visible, bodyClass, getAudios, stopCurrent]);

  useStudyVideoMedia(containerRef, `${bodyClass}:${html}`, visible);

  // -- Visibility transitions --
  const prevVisibleRef = useRef(visible);
  useEffect(() => {
    const wasVisible = prevVisibleRef.current;
    prevVisibleRef.current = visible;

    if (visible && !wasVisible) {
      // Face just became visible — start sequential playback.
      startPlayback();
    } else if (!visible && wasVisible) {
      // Face hidden — silence everything.
      stopCurrent();
      for (const audio of getAudios()) audio.pause();
    }
  }, [visible, startPlayback, stopCurrent, getAudios]);

  return (
    <CardScrollFrame contentKey={html} visible={visible}>
      <div ref={containerRef} />
      {tagLabels}
      {visible && hasAudio && (
        <button
          type="button"
          onClick={startPlayback}
          aria-label="Replay audio" title="Replay audio"
          className="anki-replay-btn"
        >
          <UiIcon name="repeat" />
        </button>
      )}
    </CardScrollFrame>
  );
}

// Main component
// ---------------------------------------------------------------------------

/**
 * Full-screen study view for one deck.
 *
 * @param db        - sql.js Database instance (null while loading).
 * @param deckId    - UUID of the deck to study.
 * @param deckName  - Human-readable deck name for the header.
 * @param onEditCard - Called when the user long-presses the card.
 * @param onExit    - Called when the user dismisses the session-complete screen.
 */
export default function Study({ db, deckId, deckName, mediaBootstrap, onExit, onSyncEdit, onSessionComplete }: StudyProps) {
  const entranceRootRef = useRef<HTMLDivElement>(null);
  const currentFaceRef = useRef<CardFace>('front');
  const [editingFace, setEditingFace] = useState<CardFace>('front');
  const [editingCard, setEditingCard] = useState<Card | null>(null);
  const [nextDueLabel, setNextDueLabel] = useState<string | null>(null);
  const practice = usePracticeDeck(db, deckId);

  const handleEditCard = useCallback((card: Card) => {
    setEditingFace(currentFaceRef.current);
    setEditingCard(card);
  }, []);

  const [deckTags, setDeckTags] = useState<TagCount[]>([]);
  const tagColors = useMemo(() => new Map(deckTags.map(tag => [tag.tag, tag.color])), [deckTags]);

  useEffect(() => {
    if (!db) return;
    const result = getTagsForDeck(db, deckId);
    if (result.success) setDeckTags(result.data);
  }, [db, deckId]);

  const session = useStudySession(db, deckId, handleEditCard, 0, null, onSyncEdit);
  const {
    phase, frontHtml, backHtml, stats, errorMessage, canUndo, ratingPreviews,
    flip, rate,  undo, editCurrentCard, updateCurrentCardInQueue,
  } = session;
  currentFaceRef.current = phase === 'back' ? 'back' : 'front';
  const choiceFeedback = useChoiceFeedback<Rating>(rating => { void rate(rating); });
  const { rewriteHtml, addMediaFile, loading: mediaLoading } = useDeckMedia(db, deckId, mediaBootstrap);
  const { theme } = useTheme();

  // Build class strings for the Anki-compatible card wrapper.
  // Anki's DOM: <body class="night_mode"><div class="card">...</div></body>
  // We replicate: <div class="night_mode"><div class="card">...</div></div>
  // so deck CSS like `.night_mode .card { color: white }` works naturally.
  const bodyClass = useMemo(() => {
    const classes: string[] = [];
    if (theme === 'dark' || theme === 'black') classes.push('night_mode');
    if (theme === 'black') classes.push('black_mode');
    return classes.join(' ');
  }, [theme]);

  // A completed session is saved once, even if sync refreshes the parent's callbacks.
  const completeRef = useRef(onSessionComplete);
  completeRef.current = onSessionComplete;
  useEffect(() => {
    if (phase === 'complete') completeRef.current?.();
  }, [phase]);

  // Compute next due label when session completes
  useEffect(() => {
    if (phase !== 'complete' || !db) return;
    const now = Math.floor(Date.now() / 1000);
    const result = getDeckStats(db, deckId, now);
    if (result.success && result.data.nextDue) {
      const diff = result.data.nextDue - now;
      if (diff <= 0) {
        setNextDueLabel('now');
      } else if (diff < 60) {
        setNextDueLabel('in less than a minute');
      } else if (diff < 3600) {
        const mins = Math.round(diff / 60);
        setNextDueLabel(`in ${mins} ${mins === 1 ? 'minute' : 'minutes'}`);
      } else if (diff < 86400) {
        const hours = Math.round(diff / 3600);
        setNextDueLabel(`in ${hours} ${hours === 1 ? 'hour' : 'hours'}`);
      } else {
        const days = Math.round(diff / 86400);
        setNextDueLabel(`in ${days} ${days === 1 ? 'day' : 'days'}`);
      }
    }
  }, [phase, db, deckId]);

  /** After the editor saves, update the card in the study queue and refresh. */
  const handleEditorSave = useCallback(
    (updated: Card) => {
      updateCurrentCardInQueue(updated);
      setEditingCard(null);
    },
    [updateCurrentCardInQueue],
  );

  const handleEditorDelete = useCallback(() => {
    setEditingCard(null);
    // Card was deleted — exit back to home since the queue is now stale.
    onExit?.();
  }, [onExit]);

  // Rewrite media src attributes (e.g. src="cat.jpg") to blob: object URLs,
  // then render Image Occlusion masks if present.
  // Memoized so the 1-second elapsed-time ticker doesn't re-run the regex work.
  const resolvedFront = useMemo(
    () => mediaLoading ? '' : renderMath(renderImageOcclusion(rewriteHtml(frontHtml), 'front')),
    [rewriteHtml, frontHtml, mediaLoading],
  );
  const resolvedBack = useMemo(
    () => mediaLoading ? '' : renderMath(renderImageOcclusion(rewriteHtml(backHtml), 'back')),
    [rewriteHtml, backHtml, mediaLoading],
  );

  const entranceReady = useSessionEntrance({ identity:deckId, ready:!mediaLoading && (phase === 'front' || phase === 'back'), contentKey:resolvedFront, rootRef:entranceRootRef });
  const hold = useHoldToEdit({ onEdit:editCurrentCard, identity:`${session.currentCard?.id}:${phase}`, disabled:!entranceReady || Boolean(editingCard) || choiceFeedback.pending || mediaLoading || (phase !== 'front' && phase !== 'back') });
  const seen = useCardSeen({ deckId:session.currentCard?.deckId ?? null, cardId:session.currentCard?.id ?? null,
    sessionKey:session.seenSessionKey, occurrenceId:session.seenOccurrenceId, mode:'study', face:phase === 'back' ? 'back' : 'front',
    enabled:entranceReady && (phase === 'front' || phase === 'back'), onFlip:flip });
  const turn = useCardTurn({
    face:phase === 'back' ? 'back' : 'front', identity:session.currentCard?.id ?? 'loading',
    disabled:!entranceReady || Boolean(editingCard) || choiceFeedback.pending || mediaLoading || hold.activated || hold.offered || (phase !== 'front' && phase !== 'back'),
    locked:hold.locked, onFlip:seen.flip, onGestureStart:hold.dismiss,
  });

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  // Review-again pass — renders instead of normal study UI, no DB writes
  if (practice.cards) {
    return (
      <ReviewPassView
        cards={practice.cards}
        {...(deckName !== undefined ? { contextLabel: deckName } : {})}
        rewriteHtml={rewriteHtml}
        db={db}
        onSyncEdit={onSyncEdit}
        onMediaAdded={addMediaFile}
        onDone={onExit ?? practice.close}
        onBack={practice.close}
      />
    );
  }

  if (phase === 'error') {
    return (
      <div className="flex flex-col min-h-[100dvh] bg-[var(--kit-bg)] text-text-light dark:text-text-dark">
        <header
          className="flex items-center gap-3 shrink-0"
          style={{
            paddingTop: 'calc(env(safe-area-inset-top) + 0.75rem)',
            paddingBottom: '0.5rem',
            paddingLeft: 'max(1rem, env(safe-area-inset-left))',
            paddingRight: 'max(1rem, env(safe-area-inset-right))',
          }}
        >
          <button
            onClick={() => { hapticTap(); onExit?.(); }}
            className="p-2 -ml-2 text-[#6B6B6B] dark:text-[#C4C4C4] hover:text-[#1c1c1e] dark:hover:text-[#E5E5E5] transition-colors shrink-0"
            aria-label="Back"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
        </header>
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-8 text-center">
          <p className="text-sm text-red-700 dark:text-red-400" role="alert">{errorMessage}</p>
        </div>
      </div>
    );
  }

  if (phase === 'complete') {
    return (
      <div className="flex flex-col h-[100dvh] bg-[var(--kit-bg)] text-[#1c1c1e] dark:text-[#E5E5E5]">
        <header
          className="flex items-center gap-3 pb-3 shrink-0"
          style={{
            paddingTop: 'calc(env(safe-area-inset-top) + 0.75rem)',
            paddingLeft: 'max(1rem, env(safe-area-inset-left))',
            paddingRight: 'max(1rem, env(safe-area-inset-right))',
          }}
        >
          <span className="w-8 shrink-0" aria-hidden="true" />
          <span className="text-[15px] font-medium truncate flex-1 text-center text-[#6B6B6B] dark:text-[#C4C4C4]">
            {deckName ?? 'Study'}
          </span>
          <span className="w-8 shrink-0" aria-hidden="true" />
        </header>
        <SessionFinish
          title={stats.studied > 0 ? 'Session complete' : 'All caught up'}
          detail={stats.studied > 0 ? `${stats.studied} ${stats.studied === 1 ? 'card' : 'cards'}` : undefined}
          nextDue={nextDueLabel}
          onPractise={practice.start}
          onDone={onExit ? () => { hapticTap(); onExit(); } : undefined}
          error={practice.error}
        />
      </div>
    );
  }


  return (
    <div ref={entranceRootRef} className={`study-session session-entrance ${turn.layoutFace === 'front' ? 'study-session--question' : ''} flex flex-col h-[100dvh] bg-[var(--kit-bg)] text-text-light dark:text-text-dark select-none`} data-entry-ready={entranceReady} aria-busy={!entranceReady} role="region" aria-label="Study session">
      <ModeAtmosphere mode="study" />
      {/* ── Header ── */}
      <header
        className="flex items-center gap-3 shrink-0 border-b border-border-light dark:border-border-dark"
        style={{
          paddingTop: 'calc(env(safe-area-inset-top) + 0.75rem)',
          paddingBottom: '0.5rem',
          paddingLeft: 'max(1rem, env(safe-area-inset-left))',
          paddingRight: 'max(1rem, env(safe-area-inset-right))',
        }}
      >
        <button
          onClick={() => { hapticTap(); onExit?.(); }}
          className="p-2 -ml-2 text-[#6B6B6B] dark:text-[#C4C4C4] hover:text-[#1c1c1e] dark:hover:text-[#E5E5E5] transition-colors shrink-0"
          aria-label="Back"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
        </button>
        <span className="text-sm font-medium text-[#6B6B6B] dark:text-[#C4C4C4] truncate flex-1 text-center">
          <span className="deck-context-label"><DeckName name={deckName ?? 'Cards'} /></span>
        </span>
        <span className="study-edit-slot"><button type="button" onClick={hold.edit} disabled={!entranceReady || choiceFeedback.pending} className="study-edit-access" aria-label="Edit current face">Edit</button></span>
      </header>

      <CardSeenNotice error={seen.error} onDismiss={seen.dismissError} />
      {/* ── Progress bar ── */}
      <StudyProgressBar progress={session.progress} />


      {/* ── Card area ── */}
      <CardTurnFrame
        controller={turn}
        locked={!entranceReady || hold.locked}
        holdBindings={hold.bindings}
        onEdit={hold.edit}
        className={`flex-1 min-h-0 relative overflow-hidden flex flex-col study-card-area ${turn.layoutFace === 'front' ? 'study-card-area--question' : ''} ${phase === 'front' ? 'cursor-pointer' : ''}`}
        front={<CardContent html={resolvedFront} visible={entranceReady && phase === 'front'} bodyClass={bodyClass} />}
        back={<CardContent html={resolvedBack} visible={entranceReady && phase === 'back'} bodyClass={bodyClass} tagLabels={<CardTagRow tags={session.currentCard?.tags ?? []} colors={tagColors} />} />}
      >
        {(hold.holding || hold.activated) && <HoldEditFeedback holding={hold.holding} activated={hold.activated} point={hold.point} />}
        {hold.offered && <HoldEditAction onEdit={hold.edit} onDismiss={hold.dismiss} face={phase === 'back' ? 'back' : 'front'} />}
        <p className="sr-only" aria-live="polite">
          {phase === 'back' ? 'Answer shown. Review it, then rate how well you remembered.' : ''}
        </p>
      </CardTurnFrame>

      {/* ── Bottom bar (rating buttons) ── */}
      {!entranceReady && <div className="session-entrance-status" role="status"><span className="sr-only">Opening deck…</span><span className="session-entrance-track" aria-hidden="true" /></div>}
      <StudyFooter face={phase === 'back' ? 'back' : 'front'} layoutFace={turn.layoutFace} seenCount={seen.count} onFlip={turn.flip} disabled={!entranceReady || choiceFeedback.pending} inert={!entranceReady}
        leading={<button type="button" onClick={() => void undo()} disabled={!canUndo} className="kit-icon-button study-previous-control text-[#777] disabled:invisible dark:text-[#aaa]" aria-label="Undo last rating">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M8 4 3 9l5 5M3 9h11a6 6 0 0 1 0 12" /></svg>
        </button>}
        frontActions={<ShowAnswerButton onReveal={turn.flip} />}
        backActions={<div className="rating-choices" role="group" aria-label="Rate your recall">
              {(['again', 'hard', 'good', 'easy'] as Rating[]).map(rating => <RatingButton
                key={rating} rating={rating} onClick={() => choiceFeedback.choose(rating)}
                selected={choiceFeedback.selected === rating} disabled={choiceFeedback.pending}
                interval={ratingPreviews ? formatInterval(ratingPreviews[rating].scheduledDays) : undefined}
                intervalLabel={ratingPreviews ? formatIntervalForSpeech(ratingPreviews[rating].scheduledDays) : undefined}
              />)}
            </div>}
      />

      {/* ── Card Editor overlay ── */}
      {editingCard && (
        <CardEditor
          db={db}
          card={editingCard}
          initialFace={editingFace}
          rewriteHtml={rewriteHtml}
          deckTags={deckTags}
          onSave={handleEditorSave}
          onDelete={handleEditorDelete}
          onDismiss={() => setEditingCard(null)}
          onMediaAdded={addMediaFile}
          onSyncEdit={onSyncEdit}
        />
      )}

      {/* ── Review limiter picker ── */}

    </div>
  );
}

// ---------------------------------------------------------------------------
