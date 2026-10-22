import type { CardState, Result, ReviewLog } from '../../types';
import type { KitCardProgress, KitProgressData } from '../../types/apkgProgress';

const ERROR = 'This file’s Kit study progress could not be read. Your existing decks have not been replaced.';
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const count = (value: unknown): value is number => positive(value) && Number.isSafeInteger(value);

function state(value: unknown): CardState | null {
  if (!object(value) || typeof value.cardId !== 'string' || !positive(value.due) || !positive(value.stability)
    || !positive(value.difficulty) || value.difficulty > 10 || !positive(value.elapsedDays) || !positive(value.scheduledDays)
    || !count(value.reps) || !count(value.lapses) || !['new', 'learning', 'review', 'relearning'].includes(String(value.state))
    || (value.lastReview !== null && !positive(value.lastReview))) return null;
  const learningStepIndex = value.learningStepIndex ?? 0;
  const suspended = value.suspended ?? false;
  if (!count(learningStepIndex) || typeof suspended !== 'boolean') return null;
  return {
    cardId:value.cardId, due:value.due, stability:value.stability, difficulty:value.difficulty,
    elapsedDays:value.elapsedDays, scheduledDays:value.scheduledDays, reps:value.reps, lapses:value.lapses,
    state:value.state as CardState['state'], lastReview:value.lastReview as number | null, learningStepIndex, suspended,
  };
}

function logs(value: unknown): ReviewLog[] | null {
  if (!Array.isArray(value)) return null;
  const result: ReviewLog[] = [];
  for (const entry of value) {
    if (!object(entry) || typeof entry.id !== 'string' || typeof entry.cardId !== 'string'
      || !['again', 'hard', 'good', 'easy'].includes(String(entry.rating)) || !positive(entry.reviewedAt)
      || !positive(entry.elapsed) || !positive(entry.scheduledDays)) return null;
    result.push({ id:entry.id, cardId:entry.cardId, rating:entry.rating as ReviewLog['rating'], reviewedAt:entry.reviewedAt, elapsed:entry.elapsed, scheduledDays:entry.scheduledDays });
  }
  return result;
}

/** Validate the optional package progress before any imported deck is committed.
 * @param json - The kit_progress.json sidecar text; unrelated Anki files omit it.
 * @returns Compatible v1/v2 scheduling records, or a visible error rather than silent loss.
 */
export function parseKitProgress(json: string): Result<KitProgressData> {
  try {
    const value: unknown = JSON.parse(json);
    if (!object(value)) return { success:false, error:ERROR };
    if (value.version === 1 && object(value.statesByContent) && object(value.logsByContent)) {
      const statesByContent: Record<string, CardState> = Object.create(null) as Record<string, CardState>;
      const logsByContent: Record<string, ReviewLog[]> = Object.create(null) as Record<string, ReviewLog[]>;
      for (const [key, raw] of Object.entries(value.statesByContent)) {
        const parsed = state(raw);
        if (!parsed) return { success:false, error:ERROR };
        statesByContent[key] = parsed;
      }
      for (const [key, raw] of Object.entries(value.logsByContent)) {
        const parsed = logs(raw);
        if (!parsed) return { success:false, error:ERROR };
        logsByContent[key] = parsed;
      }
      return { success:true, data:{ version:1, statesByContent, logsByContent } };
    }
    if (value.version === 2 && positive(value.exportedAt) && object(value.cardsById)) {
      const cardsById: Record<string, KitCardProgress> = Object.create(null) as Record<string, KitCardProgress>;
      for (const [key, raw] of Object.entries(value.cardsById)) {
        if (!/^\d+$/.test(key) || !object(raw)) return { success:false, error:ERROR };
        const parsedState = raw.state === null ? null : state(raw.state);
        const parsedLogs = logs(raw.logs);
        if ((raw.state !== null && !parsedState) || !parsedLogs) return { success:false, error:ERROR };
        cardsById[key] = { state:parsedState, logs:parsedLogs };
      }
      return { success:true, data:{ version:2, exportedAt:value.exportedAt, cardsById } };
    }
    return { success:false, error:ERROR };
  } catch { return { success:false, error:ERROR }; }
}

/** Bind one imported card to its own saved history, preserving legacy file support.
 * @param progress - A validated Kit sidecar.
 * @param cardId - Original Anki card ID from this same package.
 * @param front - Rendered front, used only for legacy v1 matching.
 * @param back - Rendered back, used only for legacy v1 matching.
 * @returns Exact per-card progress, or an explicit error for an incomplete v2 package.
 */
export function getKitCardProgress(progress: KitProgressData, cardId: string, front: string, back: string): Result<KitCardProgress> {
  if (progress.version === 2) {
    const saved = Object.hasOwn(progress.cardsById, cardId) ? progress.cardsById[cardId] : undefined;
    return saved ? { success:true, data:saved } : { success:false, error:ERROR };
  }
  const key = `${front}\x1f${back}`;
  return { success:true, data:{
    state:Object.hasOwn(progress.statesByContent, key) ? progress.statesByContent[key] ?? null : null,
    logs:Object.hasOwn(progress.logsByContent, key) ? progress.logsByContent[key] ?? [] : [],
  } };
}
