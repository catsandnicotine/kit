import { HoldEditAction } from '../components/HoldEditAction';
import { useHoldToEdit } from '../hooks/useHoldToEdit';
import { HoldEditFeedback } from '../components/HoldEditFeedback';
import { CardTagRow } from '../components/CardTagRow';
import { useCardTagColors } from '../hooks/useCardTagColors';
import { CardScrollFrame } from '../components/CardScrollFrame';
import { renderLegacyCardHints } from '../lib/cardHints';
import { CardTurnFrame } from '../components/CardTurnFrame';
import { useCardTurn } from '../hooks/useCardTurn';
import { useCardSeen } from '../hooks/useCardSeen';
import { CardSeenNotice } from '../components/CardSeenNotice';
import { useStudyVideoMedia } from '../hooks/useStudyVideoMedia';
import { CardEditor } from '../components/CardEditor';
import type { Card } from '../types';
import type { CardFace } from '../types/editorUi';
import type { EditOp } from '../lib/sync/types';
import { ModeAtmosphere } from '../components/ModeAtmosphere';
import { StudyFooter } from '../components/StudyFooter';
import { SessionFinish } from '../components/SessionFinish';
import { DeckName } from '../components/DeckName';
/**
 * ReviewStudy — physical-flashcard mode study page.
 *
 * Cards are shuffled randomly. No FSRS or scoring writes. Explicit card-content edits use the shared editor.
 * Actions: Return to the pile or put aside.
 *
 * @param db       - sql.js Database instance (null while loading).
 * @param deckId   - Deck UUID.
 * @param deckName - Deck display name.
 * @param onExit   - Called when the user leaves (back or done).
 */

import { ShowAnswerButton } from '../components/ShowAnswerButton';
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Database } from 'sql.js';
import { useReviewStudySession } from '../hooks/useReviewStudySession';
import { useChoiceFeedback } from '../hooks/useChoiceFeedback';
import { useDeckMedia } from '../hooks/useDeckMedia';
import { useTheme } from '../hooks/useTheme';
import { hapticTap } from '../lib/platform/haptics';
import { ReviewChoices } from '../components/ReviewChoices';
import { useSessionEntrance } from '../hooks/useSessionEntrance';
import type { DeckMediaBootstrap } from '../types/deckMedia';
import '../components/SessionEntrance.css';
import { renderImageOcclusion } from '../lib/imageOcclusion';

// ---------------------------------------------------------------------------
// Card content renderer — uses ref-based innerHTML for script/mask compat
// ---------------------------------------------------------------------------

function CardContent({
  html,
  bodyClass,
  visible,
  tagLabels,
}: {
  html: string;
  bodyClass: string;
  visible: boolean;
  tagLabels?: ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const currentHtmlRef = useRef('');

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const outerOpen = bodyClass ? `<div class="${bodyClass}">` : '';
    const outerClose = bodyClass ? '</div>' : '';
    const fullHtml = `${outerOpen}<div class="card">${renderLegacyCardHints(html)}</div>${outerClose}`;
    if (currentHtmlRef.current === fullHtml) return;
    currentHtmlRef.current = fullHtml;
    el.innerHTML = fullHtml;
  }, [html, bodyClass]);
  useStudyVideoMedia(containerRef, `${bodyClass}:${html}`, visible);

  return (
    <CardScrollFrame contentKey={html} visible={visible}>
      <div ref={containerRef} />
      {tagLabels}
    </CardScrollFrame>
  );
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

interface ReviewStudyProps {
  db: Database | null;
  deckId: string;
  deckName: string;
  mediaBootstrap?: DeckMediaBootstrap | null;
  onExit: () => void;
  onSyncEdit?: ((ops: EditOp[]) => void) | undefined;
}

export default function ReviewStudy({ db, deckId, deckName, mediaBootstrap, onExit, onSyncEdit }: ReviewStudyProps) {
  const entranceRootRef = useRef<HTMLDivElement>(null);
  const [editingCard, setEditingCard] = useState<Card | null>(null);
  const [editingFace, setEditingFace] = useState<CardFace>('front');
  const session = useReviewStudySession(db, deckId);
  const {
    phase,
    currentCard,
    stats,
    flip,
    sendToBack,
    putAside,
    reshufflePutAside,
  } = session;
  const tagColors = useCardTagColors(db, currentCard?.deckId);
  const choiceFeedback = useChoiceFeedback<'again' | 'aside'>(choice => choice === 'again' ? sendToBack() : putAside());

  const { rewriteHtml, addMediaFile, loading: mediaLoading } = useDeckMedia(db, deckId, mediaBootstrap);
  const { theme } = useTheme();

  const bodyClass = useMemo(() => {
    const classes: string[] = [];
    if (theme === 'dark' || theme === 'black') classes.push('night_mode');
    if (theme === 'black') classes.push('black_mode');
    return classes.join(' ');
  }, [theme]);

  const frontHtml = useMemo(() => {
    if (!currentCard || mediaLoading) return '';
    return renderImageOcclusion(rewriteHtml(currentCard.front), 'front');
  }, [currentCard, rewriteHtml, mediaLoading]);

  const backHtml = useMemo(() => {
    if (!currentCard || mediaLoading) return '';
    return renderImageOcclusion(rewriteHtml(currentCard.back), 'back');
  }, [currentCard, rewriteHtml, mediaLoading]);

  const entranceReady = useSessionEntrance({ identity:deckId, ready:!mediaLoading && (phase === 'front' || phase === 'back'), contentKey:frontHtml, rootRef:entranceRootRef });
  const hold = useHoldToEdit({ identity:`${currentCard?.id}:${phase}`, disabled:!entranceReady || choiceFeedback.pending || mediaLoading || Boolean(editingCard) || !currentCard,
    onEdit:() => { if (currentCard) { setEditingFace(phase === 'back' ? 'back' : 'front'); setEditingCard(currentCard); } } });
  const seen = useCardSeen({ deckId:currentCard?.deckId ?? null, cardId:currentCard?.id ?? null,
    sessionKey:session.seenSessionKey, occurrenceId:session.seenOccurrenceId, mode:'practice', face:phase === 'back' ? 'back' : 'front',
    enabled:entranceReady && (phase === 'front' || phase === 'back'), onFlip:flip });
  const turn = useCardTurn({
    face:phase === 'back' ? 'back' : 'front', identity:currentCard?.id ?? 'loading',
    disabled:!entranceReady || choiceFeedback.pending || mediaLoading || Boolean(editingCard) || !currentCard || hold.activated || hold.offered,
    locked:hold.locked, onFlip:seen.flip, onGestureStart:hold.dismiss,
  });

  if (phase === 'error') return <main className="h-[100dvh] flex flex-col bg-[var(--kit-bg)] text-[#1c1c1e] dark:text-[#E5E5E5]">
    <header className="kit-page-header"><button type="button" className="kit-icon-button" onClick={onExit} aria-label="Back">‹</button><span className="deck-context-label"><DeckName name={deckName} /></span></header>
    <div className="flex-1 flex flex-col items-center justify-center gap-5 px-6"><p role="alert" className="text-sm">{session.errorMessage}</p><button type="button" className="kit-secondary-button" onClick={session.retry}>Try again</button></div>
  </main>;

  // ── Complete ────────────────────────────────────────────────────────────
  if (phase === 'complete') {
    return <div className="h-[100dvh] flex flex-col bg-[var(--kit-bg)] text-[#1c1c1e] dark:text-[#E5E5E5]">
      <header className="practice-finish-header"><span className="deck-context-label"><DeckName name={deckName} /></span></header>
      <SessionFinish showMark={stats.total > 0} title={stats.total ? 'Practice complete' : 'No cards yet'} detail={stats.total ? `${stats.putAside} ${stats.putAside === 1 ? 'card' : 'cards'}` : undefined} onDone={() => { hapticTap(); onExit(); }} onPractise={stats.putAside > 0 ? reshufflePutAside : undefined} />
    </div>;
  }

  // ── Study screen ────────────────────────────────────────────────────────
  return (
    <div ref={entranceRootRef} className={`study-session session-entrance ${turn.layoutFace === 'front' ? 'study-session--question' : ''} h-[100dvh] flex flex-col bg-[var(--kit-bg)] text-[#1c1c1e] dark:text-[#E5E5E5] select-none`} data-entry-ready={entranceReady} aria-busy={!entranceReady} role="region" aria-label="Practice session">
      <ModeAtmosphere mode="practice" />
      {/* Header */}
      <header
        className="flex items-center gap-3 shrink-0 border-b border-[#E5E5E5] dark:border-[#262626]"
        style={{
          paddingTop: 'calc(env(safe-area-inset-top) + 0.75rem)',
          paddingBottom: '0.5rem',
          paddingLeft: 'max(1rem, env(safe-area-inset-left))',
          paddingRight: 'max(1rem, env(safe-area-inset-right))',
        }}
      >
        <button
          onClick={() => { hapticTap(); onExit(); }}
          className="p-2 -ml-2 text-[#C4C4C4] hover:text-[#1c1c1e] dark:hover:text-[#E5E5E5] transition-colors shrink-0"
          aria-label="Back"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <span className="text-sm font-medium text-[#C4C4C4] truncate flex-1 text-center">
          <span className="deck-context-label"><DeckName name={deckName} /></span>
        </span>
        <span className="text-xs text-[#C4C4C4] shrink-0 tabular-nums">
          {stats.remaining} left
        </span>
      </header>


      <CardSeenNotice error={seen.error} onDismiss={seen.dismissError} />
      <button type="button" disabled={!entranceReady} className="study-edit-access" aria-label="Edit current face" onClick={hold.edit}>Edit</button>
      {/* Card area — tap or drag horizontally to turn */}
      <CardTurnFrame
        controller={turn}
        locked={!entranceReady || hold.locked}
        holdBindings={hold.bindings}
        onEdit={hold.edit}
        className={`flex-1 min-h-0 relative overflow-hidden study-card-area ${turn.layoutFace === 'front' ? 'study-card-area--question' : ''}`}
        front={<CardContent html={frontHtml} bodyClass={bodyClass} visible={entranceReady && phase === 'front'} />}
        back={<CardContent html={backHtml} bodyClass={bodyClass} visible={entranceReady && phase === 'back'} tagLabels={<CardTagRow tags={currentCard?.tags ?? []} colors={tagColors} />} />}
      >
        {(hold.holding || hold.activated) && <HoldEditFeedback holding={hold.holding} activated={hold.activated} point={hold.point} />}
        {hold.offered && <HoldEditAction onEdit={hold.edit} onDismiss={hold.dismiss} face={phase === 'back' ? 'back' : 'front'} />}
      </CardTurnFrame>

      {!entranceReady && <div className="session-entrance-status" role="status"><span className="sr-only">Opening deck…</span><span className="session-entrance-track" aria-hidden="true" /></div>}
      <StudyFooter face={phase === 'back' ? 'back' : 'front'} layoutFace={turn.layoutFace} seenCount={seen.count} onFlip={turn.flip} disabled={!entranceReady || choiceFeedback.pending} inert={!entranceReady}
        frontActions={<ShowAnswerButton onReveal={turn.flip} practice />}
        backActions={<ReviewChoices onRepeat={() => choiceFeedback.choose('again')} onPutAside={() => choiceFeedback.choose('aside')} selected={choiceFeedback.selected} pending={choiceFeedback.pending} />}
      />
      {editingCard && <CardEditor db={db} card={editingCard} initialFace={editingFace} rewriteHtml={rewriteHtml} onMediaAdded={addMediaFile} onSyncEdit={onSyncEdit}
        onSave={updated => { session.updateCard(updated); setEditingCard(null); }} onDelete={onExit} onDismiss={() => setEditingCard(null)} />}
    </div>
  );
}
