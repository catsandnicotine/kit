import { describe, expect, it } from 'vitest';
import type { Card } from '../types';
import { choosePractice, createPracticeQueue, navigatePractice, updatePracticeCard } from './practiceNavigation';

const cards: Card[] = ['a', 'b', 'c'].map(id => ({ id, deckId:'deck', noteId:null, front:`Question ${id}`, back:`Answer ${id}`, tags:[], createdAt:0, updatedAt:0 }));

describe('practice browsing without a recall decision', () => {
  it('keeps an empty queue at both boundaries without inventing a review', () => {
    const queue = createPracticeQueue([]);
    expect(navigatePractice(queue, 'next')).toBe(queue);
    expect(navigatePractice(queue, 'previous')).toBe(queue);
    expect(choosePractice(queue, 'aside', 'unused')).toBe(queue);
    expect(queue.putAside).toBe(0);
  });

  it('lets a single card finish without revealing, repeating or putting it aside', () => {
    const queue = createPracticeQueue(cards.slice(0, 1));
    expect(navigatePractice(queue, 'previous')).toBe(queue);
    const finished = navigatePractice(queue, 'next');
    expect(finished.index).toBe(1);
    expect(finished.entries).toBe(queue.entries);
    expect(finished.putAside).toBe(0);
    expect(finished.repeats).toBe(0);
    expect(finished.remaining).toBe(0);
    expect(navigatePractice(finished, 'previous').remaining).toBe(1);
    expect(navigatePractice(finished, 'next')).toBe(finished);
  });

  it('preserves occurrence identities when revisiting an unrevealed or revealed card', () => {
    const queue = createPracticeQueue(cards);
    const forward = navigatePractice(queue, 'next');
    const backward = navigatePractice(forward, 'previous');
    expect(backward.entries[backward.index]).toBe(queue.entries[0]);
    expect(navigatePractice(backward, 'next').entries[1]).toBe(forward.entries[1]);
    expect(backward.putAside).toBe(0);
    expect(backward.repeats).toBe(0);
  });

  it.each(['again', 'aside'] as const)('does not apply %s twice or undo it when browsing history', choice => {
    const initial = createPracticeQueue(cards);
    const chosen = choosePractice(initial, choice, 'repeat-a');
    const history = navigatePractice(chosen, 'previous');
    expect(history.entries[0]?.choice).toBe(choice);
    expect(choosePractice(history, choice, 'should-not-exist')).toBe(history);
    expect(navigatePractice(history, 'next').entries).toBe(chosen.entries);
    expect(initial.entries[0]?.choice).toBeNull();
    expect(history.putAside).toBe(choice === 'aside' ? 1 : 0);
    expect(history.repeats).toBe(choice === 'again' ? 1 : 0);
    expect(history.remaining).toBe(chosen.remaining);
  });

  it('creates a new answer-count occurrence only for an explicit Again', () => {
    const initial = createPracticeQueue(cards);
    const chosen = choosePractice(initial, 'again', 'repeat-a');
    expect(chosen.entries.map(entry => entry.card.id)).toEqual(['a', 'b', 'c', 'a']);
    expect(chosen.entries[3]).toMatchObject({ occurrenceId:'repeat-a', choice:null });
    expect(chosen.entries[3]?.occurrenceId).not.toBe(chosen.entries[0]?.occurrenceId);
    let position = chosen;
    while (position.index < position.entries.length) position = navigatePractice(position, 'next');
    expect(position.putAside).toBe(0);
    expect(position.repeats).toBe(1);
    expect(position.entries.length).toBe(4);
  });

  it('preserves the 5–10-position repeat policy for a review pass', () => {
    const longCards = Array.from({ length:15 }, (_, index) => ({ ...cards[0]!, id:String(index) }));
    const queue = choosePractice(createPracticeQueue(longCards), 'again', 'repeat', 7);
    expect(queue.entries[7]).toMatchObject({ card:{ id:'0' }, occurrenceId:'repeat', choice:null });
    expect(queue.index).toBe(1);
    expect(queue.entries[8]?.card.id).toBe('7');
  });

  it('updates edited content in history and repeats without changing their decisions or identities', () => {
    const initial = choosePractice(createPracticeQueue(cards), 'again', 'repeat-a');
    const edited = { ...cards[0]!, front:'Edited question' };
    const updated = updatePracticeCard(initial, edited);
    expect(updated.entries[0]).toMatchObject({ card:edited, choice:'again', occurrenceId:'0' });
    expect(updated.entries[3]).toMatchObject({ card:edited, choice:null, occurrenceId:'repeat-a' });
    expect(updated.index).toBe(initial.index);
    expect(updated.putAside).toBe(initial.putAside);
    expect(initial.entries[0]?.card.front).toBe('Question a');
  });
});
