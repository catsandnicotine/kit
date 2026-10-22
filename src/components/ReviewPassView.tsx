import { HoldEditAction } from './HoldEditAction';
import { useHoldToEdit } from '../hooks/useHoldToEdit';
import { HoldEditFeedback } from './HoldEditFeedback';
import { CardTagRow } from './CardTagRow';
import { useCardTagColors } from '../hooks/useCardTagColors';
import { CardScrollFrame } from './CardScrollFrame';
import { renderLegacyCardHints } from '../lib/cardHints';
import { CardTurnFrame } from './CardTurnFrame';
import { useCardTurn } from '../hooks/useCardTurn';
import { useCardSeen } from '../hooks/useCardSeen';
import { CardSeenNotice } from './CardSeenNotice';
import { useStudyVideoMedia } from '../hooks/useStudyVideoMedia';
import { CardEditor } from './CardEditor';
import type { CardFace } from '../types/editorUi';
import type { Database } from 'sql.js';
import type { EditOp } from '../lib/sync/types';
import { ModeAtmosphere } from './ModeAtmosphere';
import { StudyFooter } from './StudyFooter';
import { SessionFinish } from './SessionFinish';
import { DeckName } from './DeckName';
/**
 * ReviewPassView — full-screen consequence-free review UI.
 *
 * Used from Study (Review Again) and Browse (review selected cards).
 * No scheduling writes. Explicit card edits use the shared editor when a database is available.
 */

import { ShowAnswerButton } from './ShowAnswerButton';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import type { Card } from '../types';
import { useReviewPass } from '../hooks/useReviewPass';
import { useChoiceFeedback } from '../hooks/useChoiceFeedback';
import { hapticTap } from '../lib/platform/haptics';
import { ReviewChoices } from './ReviewChoices';
import { useTheme } from '../hooks/useTheme';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ReviewPassViewProps {
  /** Cards to review. The list is copied into a mutable queue. */
  cards: Card[];
  db?: Database | null | undefined;
  onSyncEdit?: ((ops: EditOp[]) => void) | undefined;
  onMediaAdded?: ((filename: string, url: string) => void) | undefined;
  /** Human-readable context label shown in the header (e.g. deck name). */
  contextLabel?: string;
  /** Rewrite media src→blob for display. */
  rewriteHtml?: (html: string) => string;
  /** Called when the user finishes (complete screen Done button or header Back). */
  onDone: () => void;
  onBack?: (() => void) | undefined;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function CardContent({
  html,
  visible,
  tagLabels,
}: {
  html: string;
  visible: boolean;
  tagLabels?: ReactNode;
}) {
  const { theme } = useTheme();
  const bodyClass = theme === 'black' ? 'night_mode black_mode' : theme === 'dark' ? 'night_mode' : '';
  const containerRef = useRef<HTMLDivElement>(null);
  useStudyVideoMedia(containerRef, `${bodyClass}:${html}`, visible);
  return (
    <CardScrollFrame contentKey={html} visible={visible}>
      <div ref={containerRef} dangerouslySetInnerHTML={{ __html: `<div class="${bodyClass}"><div class="card">${renderLegacyCardHints(html)}</div></div>` }} />
      {tagLabels}
    </CardScrollFrame>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Full-screen no-scoring review view.
 *
 * @param cards        - Cards to review.
 * @param contextLabel - Deck/context name shown in header.
 * @param rewriteHtml  - Media URL rewriter.
 * @param onDone       - Called when the session is finished.
 */
export function ReviewPassView({
  cards,
  db,
  onSyncEdit,
  onMediaAdded,
  contextLabel,
  rewriteHtml,
  onDone,
  onBack,
}: ReviewPassViewProps) {
  const [editingCard, setEditingCard] = useState<Card | null>(null);
  const [editingFace, setEditingFace] = useState<CardFace>('front');
  const session = useReviewPass(cards);
  const { phase, currentCard, stats, flip, gotIt, repeat } = session;
  const tagColors = useCardTagColors(db, currentCard?.deckId);
  const choiceFeedback = useChoiceFeedback<'again' | 'aside'>(choice => choice === 'again' ? repeat() : gotIt());

  const hold = useHoldToEdit({ identity:`${currentCard?.id}:${phase}`, disabled:!db || !currentCard || choiceFeedback.pending || Boolean(editingCard),
    onEdit:() => { if (currentCard) { setEditingFace(phase === 'back' ? 'back' : 'front'); setEditingCard(currentCard); } } });
  const seen = useCardSeen({ deckId:currentCard?.deckId ?? null, cardId:currentCard?.id ?? null,
    sessionKey:session.seenSessionKey, occurrenceId:session.seenOccurrenceId, mode:'practice', face:phase === 'back' ? 'back' : 'front',
    enabled:phase === 'front' || phase === 'back', onFlip:flip });
  const turn = useCardTurn({
    face:phase === 'back' ? 'back' : 'front', identity:currentCard?.id ?? 'complete',
    disabled:choiceFeedback.pending || Boolean(editingCard) || !currentCard || hold.activated || hold.offered,
    locked:hold.locked, onFlip:seen.flip, onGestureStart:hold.dismiss,
  });

  const frontHtml = useMemo(() => {
    if (!currentCard) return '';
    return rewriteHtml ? rewriteHtml(currentCard.front) : currentCard.front;
  }, [currentCard, rewriteHtml]);

  const backHtml = useMemo(() => {
    if (!currentCard) return '';
    return rewriteHtml ? rewriteHtml(currentCard.back) : currentCard.back;
  }, [currentCard, rewriteHtml]);

  const progress = cards.length === 0 ? 1 : stats.reviewed / cards.length;

  // ── Complete screen ────────────────────────────────────────────────────
  if (phase === 'complete') {
    return <div className="h-[100dvh] flex flex-col bg-[var(--kit-bg)] text-[#1c1c1e] dark:text-[#E5E5E5]">
      <header className="practice-finish-header"><DeckName name={contextLabel ?? 'Practice'} /></header>
      <SessionFinish showMark={stats.reviewed > 0} title={stats.reviewed ? 'Practice complete' : 'No cards yet'} detail={stats.reviewed ? `${stats.reviewed} ${stats.reviewed === 1 ? 'card' : 'cards'}` : undefined} onDone={() => { hapticTap(); onDone(); }} />
    </div>;
  }

  // ── Study screen ───────────────────────────────────────────────────────
  return (
    <div className={`study-session ${turn.layoutFace === 'front' ? 'study-session--question' : ''} h-[100dvh] flex flex-col bg-[var(--kit-bg)] text-[#1c1c1e] dark:text-[#E5E5E5] select-none`} role="region" aria-label="Practice session">
      <ModeAtmosphere mode="practice" />
      {/* Header */}
      <header
        className="flex items-center gap-3 shrink-0 border-b border-[#E5E5E5] dark:border-[#262626]"
        style={{
          paddingTop: 'env(safe-area-inset-top)',
          paddingBottom: '0.5rem',
          paddingLeft: 'max(1rem, env(safe-area-inset-left))',
          paddingRight: 'max(1rem, env(safe-area-inset-right))',
        }}
      >
        <button
          onClick={() => { hapticTap(); (onBack ?? onDone)(); }}
          aria-label="Back"
          className="kit-icon-button text-sm font-medium text-[#1c1c1e] dark:text-[#E5E5E5] shrink-0"
        >
          ← Back
        </button>
        <span className="text-sm font-medium text-[#C4C4C4] truncate flex-1 text-center">
          <span className="deck-context-label"><DeckName name={contextLabel ?? 'Cards'} /></span>
        </span>
        <span className="text-xs text-[#C4C4C4] shrink-0 tabular-nums">
          {stats.remaining} left
        </span>
      </header>

      <CardSeenNotice error={seen.error} onDismiss={seen.dismissError} />
      {/* Progress bar */}
      <div className="study-progress px-4 py-1">
        <div className="deck-progress-track bg-[#E5E5E5] dark:bg-[#262626] w-full">
          <div
            className="deck-progress-fill bg-[#1c1c1e] dark:bg-[#E5E5E5]"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
      </div>


      {db && <button type="button" className="study-edit-access" aria-label="Edit current face" onClick={hold.edit}>Edit</button>}
      {/* Card area */}
      <CardTurnFrame
        controller={turn}
        locked={hold.locked}
        holdBindings={hold.bindings}
        onEdit={hold.edit}
        className={`flex-1 min-h-0 relative overflow-hidden cursor-pointer study-card-area ${turn.layoutFace === 'front' ? 'study-card-area--question' : ''}`}
        front={<CardContent html={frontHtml} visible={phase === 'front'} />}
        back={<CardContent html={backHtml} visible={phase === 'back'} tagLabels={<CardTagRow tags={currentCard?.tags ?? []} colors={tagColors} />} />}
      >
        {(hold.holding || hold.activated) && <HoldEditFeedback holding={hold.holding} activated={hold.activated} point={hold.point} />}
        {hold.offered && <HoldEditAction onEdit={hold.edit} onDismiss={hold.dismiss} face={phase === 'back' ? 'back' : 'front'} />}
      </CardTurnFrame>

      {/* Bottom bar */}
      <StudyFooter face={phase === 'front' ? 'front' : 'back'} layoutFace={turn.layoutFace} seenCount={seen.count} onFlip={turn.flip} disabled={choiceFeedback.pending}
        frontActions={<ShowAnswerButton onReveal={turn.flip} practice />}
        backActions={<ReviewChoices onRepeat={() => choiceFeedback.choose('again')} onPutAside={() => choiceFeedback.choose('aside')} selected={choiceFeedback.selected} pending={choiceFeedback.pending} />}
      />
      {db && editingCard && <CardEditor db={db} card={editingCard} initialFace={editingFace} {...(rewriteHtml ? { rewriteHtml } : {})} {...(onMediaAdded ? { onMediaAdded } : {})} onSyncEdit={onSyncEdit}
        onSave={updated => { session.updateCard(updated); setEditingCard(null); }} onDelete={onDone} onDismiss={() => setEditingCard(null)} />}
    </div>
  );
}
