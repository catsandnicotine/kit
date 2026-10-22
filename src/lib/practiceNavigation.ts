import type { Card } from '../types';
import type { PracticeChoice, PracticeDirection, PracticeQueue } from '../types/practiceNavigation';

/** Start a session whose original occurrences survive backward/forward browsing.
 * @param cards - Cards in the chosen practice order.
 * @returns A fresh queue without any scheduling or reveal records.
 */
export function createPracticeQueue(cards: Card[]): PracticeQueue {
  return { entries:cards.map((card, index) => ({ card, occurrenceId:String(index), choice:null })), index:0, initialCount:cards.length, remaining:cards.length, putAside:0, repeats:0 };
}

/** Browse without revealing an answer, recording a decision or undoing one.
 * @param queue - Current practice queue.
 * @param direction - Adjacent occurrence to visit; Next from the last card finishes.
 * @returns The next queue position, or the original queue at a boundary.
 */
export function navigatePractice(queue: PracticeQueue, direction: PracticeDirection): PracticeQueue {
  const index = queue.index + (direction === 'previous' ? -1 : 1);
  if (index < 0 || index > queue.entries.length || queue.entries.length === 0) return queue;
  const crossed = queue.entries[direction === 'previous' ? index : queue.index];
  const change = crossed?.choice === null ? (direction === 'previous' ? 1 : -1) : 0;
  return { ...queue, index, remaining:queue.remaining + change };
}

/** Commit one explicit practice decision while retaining its browseable history.
 * @param queue - Queue containing the current occurrence.
 * @param choice - Return this occurrence to the pile, or put its card aside.
 * @param repeatId - Fresh identity for a repeated occurrence.
 * @param repeatOffset - Repeat distance; omitted means the end of the pile.
 * @returns An advanced queue; already-chosen historical occurrences stay unchanged.
 */
export function choosePractice(queue: PracticeQueue, choice: PracticeChoice, repeatId: string, repeatOffset?: number): PracticeQueue {
  const current = queue.entries[queue.index];
  if (!current || current.choice !== null) return queue;
  const entries = [...queue.entries];
  entries[queue.index] = { ...current, choice };
  if (choice === 'again') {
    const insertAt = repeatOffset === undefined || !Number.isFinite(repeatOffset) ? entries.length : Math.min(entries.length, queue.index + Math.max(1, Math.floor(repeatOffset)));
    entries.splice(insertAt, 0, { card:current.card, occurrenceId:repeatId, choice:null });
  }
  return { ...queue, entries, index:queue.index + 1, remaining:queue.remaining - (choice === 'aside' ? 1 : 0), putAside:queue.putAside + (choice === 'aside' ? 1 : 0), repeats:queue.repeats + (choice === 'again' ? 1 : 0) };
}

/** Apply a deliberate content edit across original and repeated occurrences.
 * @param queue - In-memory practice queue.
 * @param card - Saved card content.
 * @returns Updated content with identical decisions, occurrence IDs and position.
 */
export function updatePracticeCard(queue: PracticeQueue, card: Card): PracticeQueue {
  return { ...queue, entries:queue.entries.map(entry => entry.card.id === card.id ? { ...entry, card } : entry) };
}
