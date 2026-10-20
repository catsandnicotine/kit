import type { StudyProgress } from '../types/studyProgress';

/** Count distinct cards, keeping queued repeats unfinished and the denominator stable.
 * @param cardIds - Session queue, including already visited cards and appended repeats.
 * @param currentIndex - First pending position in that queue.
 * @param complete - Whether the session has actually finished.
 * @returns Bounded progress for this session, never a claim of mastery.
 */
export function getStudyProgress(cardIds: readonly string[], currentIndex: number, complete = false): StudyProgress {
  const total = new Set(cardIds).size;
  const remaining = complete ? 0 : new Set(cardIds.slice(Math.max(0, currentIndex))).size;
  const completed = total - remaining;
  return { completed, total, remaining, percent: total === 0 ? 0 : completed / total * 100 };
}
