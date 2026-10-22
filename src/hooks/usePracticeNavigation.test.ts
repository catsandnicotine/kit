import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { Database } from 'sql.js';
import type { Card } from '../types';
import { getCardsByDeck } from '../lib/db/queries';
import { hapticCelebration, hapticFlip, hapticNavigate } from '../lib/platform/haptics';
import { useReviewPass } from './useReviewPass';
import { useReviewStudySession } from './useReviewStudySession';

const runtime = vi.hoisted(() => ({ cursor:0, slots:[] as unknown[], effects:[] as (() => void)[], changed:false, uuid:0 }));
vi.mock('react', () => {
  const unchanged = (first: readonly unknown[], second: readonly unknown[]) => first.length === second.length && first.every((value, index) => Object.is(value, second[index]));
  return {
    useState<T>(initial: T | (() => T)) {
      const index = runtime.cursor++;
      if (!(index in runtime.slots)) runtime.slots[index] = typeof initial === 'function' ? (initial as () => T)() : initial;
      return [runtime.slots[index] as T, (next: T | ((previous: T) => T)) => {
        const value = typeof next === 'function' ? (next as (previous: T) => T)(runtime.slots[index] as T) : next;
        if (!Object.is(value, runtime.slots[index])) { runtime.slots[index] = value; runtime.changed = true; }
      }];
    },
    useRef<T>(initial: T) {
      const index = runtime.cursor++;
      if (!(index in runtime.slots)) runtime.slots[index] = { current:initial };
      return runtime.slots[index] as { current:T };
    },
    useCallback<T>(value: T, deps: readonly unknown[]) {
      const index = runtime.cursor++;
      const previous = runtime.slots[index] as { value:T; deps:readonly unknown[] } | undefined;
      if (previous && unchanged(previous.deps, deps)) return previous.value;
      runtime.slots[index] = { value, deps };
      return value;
    },
    useLayoutEffect(effect: () => void, deps: readonly unknown[]) {
      const index = runtime.cursor++;
      const previous = runtime.slots[index] as { deps:readonly unknown[] } | undefined;
      if (previous && unchanged(previous.deps, deps)) return;
      runtime.slots[index] = { deps };
      runtime.effects.push(effect);
    },
  };
});
// Only the deck read exists in this mock. Any added database/scheduler write import fails this test module.
vi.mock('../lib/db/queries', () => ({ getCardsByDeck:vi.fn() }));
vi.mock('../lib/platform/haptics', () => ({ hapticFlip:vi.fn(), hapticNavigate:vi.fn(), hapticCelebration:vi.fn() }));
vi.mock('uuid', () => ({ v4:() => `practice-${runtime.uuid++}` }));

const db = {} as Database;
const sourceCards: Card[] = ['a', 'b', 'c'].map(id => ({ id, deckId:'deck', noteId:null, front:`Question ${id}`, back:`Answer ${id}`, tags:[], createdAt:0, updatedAt:0 }));
let cards = sourceCards;

function render(route: 'library' | 'pass') {
  let result!: ReturnType<typeof useReviewPass> | ReturnType<typeof useReviewStudySession>;
  do {
    runtime.changed = false;
    runtime.cursor = 0;
    // eslint-disable-next-line react-hooks/rules-of-hooks -- Mock hook runtime flushes layout-driven rerenders before returning its snapshot.
    result = route === 'library' ? useReviewStudySession(db, 'deck') : useReviewPass(cards);
    for (const effect of runtime.effects.splice(0)) effect();
  } while (runtime.changed);
  return result;
}

function putAside(session: ReturnType<typeof render>) {
  if ('gotIt' in session) session.gotIt();
  else session.putAside();
}

function again(session: ReturnType<typeof render>) {
  if ('repeat' in session) session.repeat();
  else session.sendToBack();
}

describe.each(['library', 'pass'] as const)('%s Practice navigation', route => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtime.cursor = 0; runtime.slots = []; runtime.effects = []; runtime.changed = false; runtime.uuid = 0;
    cards = sourceCards;
    vi.mocked(getCardsByDeck).mockImplementation(() => ({ success:true, data:cards }));
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
  });
  afterEach(() => vi.restoreAllMocks());

  it('keeps empty sessions complete and both boundaries disabled', () => {
    cards = [];
    const session = render(route);
    expect(session.phase).toBe('complete');
    expect(session.currentCard).toBeNull();
    expect(session.canPrevious).toBe(false);
    expect(session.canNext).toBe(false);
    session.previous(); session.next(); session.flip();
    expect(hapticNavigate).not.toHaveBeenCalled();
    expect(hapticCelebration).not.toHaveBeenCalled();
  });

  it('can finish one unrevealed card without creating a review or reveal', () => {
    cards = sourceCards.slice(0, 1);
    const first = render(route);
    expect(first.canPrevious).toBe(false);
    expect(first.canNext).toBe(true);
    first.previous();
    expect(hapticNavigate).not.toHaveBeenCalled();
    first.next();
    const finished = render(route);
    expect(finished.phase).toBe('complete');
    expect(finished.currentCard).toBeNull();
    expect(finished.stats.remaining).toBe(0);
    expect('reviewed' in finished.stats ? finished.stats.reviewed : finished.stats.putAside).toBe(0);
    expect(hapticFlip).not.toHaveBeenCalled();
    expect(hapticCelebration).not.toHaveBeenCalled();
    expect(finished.canPrevious).toBe(true);
    expect(finished.canNext).toBe(false);
    finished.previous();
    const revisited = render(route);
    expect(revisited.phase).toBe('front');
    expect(revisited.seenOccurrenceId).toBe(first.seenOccurrenceId);
    expect(revisited.canChoose).toBe(true);
    expect(hapticFlip).not.toHaveBeenCalled();
  });

  it.each(['front', 'back'] as const)('browses from the %s face and always opens the adjacent question', face => {
    let session = render(route);
    const original = session.seenOccurrenceId;
    if (face === 'back') { session.flip(); session = render(route); }
    session.next();
    session = render(route);
    expect(session.currentCard?.id).toBe('b');
    expect(session.phase).toBe('front');
    expect(session.canPrevious).toBe(true);
    session.flip();
    session = render(route);
    session.previous();
    session = render(route);
    expect(session.currentCard?.id).toBe('a');
    expect(session.phase).toBe('front');
    expect(session.seenOccurrenceId).toBe(original);
    expect(session.canChoose).toBe(true);
  });

  it('does not accept an answer choice on a question, even through a stale callback', () => {
    const stale = render(route);
    putAside(stale); again(stale);
    expect(render(route).currentCard?.id).toBe('a');
    stale.flip();
    stale.next();
    // A navigation and an old answer handler in the same render must not rate the new question.
    putAside(stale); again(stale);
    const current = render(route);
    expect(current.currentCard?.id).toBe('b');
    expect(current.phase).toBe('front');
    expect('reviewed' in current.stats ? current.stats.reviewed : current.stats.putAside).toBe(0);
  });

  it('keeps prior decisions read-only when revisited, then continues into the existing queue', () => {
    let session = render(route);
    session.flip();
    session = render(route);
    again(session);
    session = render(route);
    expect(session.currentCard?.id).toBe('b');
    expect(session.stats.remaining).toBe(3);
    session.previous();
    session = render(route);
    expect(session.currentCard?.id).toBe('a');
    expect(session.canChoose).toBe(false);
    session.flip();
    session = render(route);
    again(session); putAside(session);
    expect(render(route).currentCard?.id).toBe('a');
    expect(render(route).stats.remaining).toBe(3);
    session.next();
    session = render(route);
    session.next();
    session = render(route);
    session.next();
    session = render(route);
    expect(session.currentCard?.id).toBe('a');
    expect(session.seenOccurrenceId).not.toBe('0');
    expect(session.canChoose).toBe(true);
    session.flip();
    session = render(route);
    putAside(session);
    session = render(route);
    expect(session.phase).toBe('complete');
    expect('reviewed' in session.stats ? session.stats.reviewed : session.stats.putAside).toBe(1);
    expect(hapticCelebration).toHaveBeenCalledTimes(1);
    expect(session.canPrevious).toBe(true);
    session.previous();
    session = render(route);
    expect(session.phase).toBe('front');
    expect(session.canChoose).toBe(false);
    session.flip();
    session = render(route);
    putAside(session);
    expect(render(route).phase).toBe('back');
    expect('reviewed' in session.stats ? session.stats.reviewed : session.stats.putAside).toBe(1);
    session.next();
    expect(render(route).phase).toBe('complete');
    expect(hapticCelebration).toHaveBeenCalledTimes(1);
  });

  it('preserves edited card content and occurrence identity when navigating back', () => {
    let session = render(route);
    const occurrence = session.seenOccurrenceId;
    session.updateCard({ ...sourceCards[0]!, front:'Edited front' });
    session = render(route);
    session.next();
    session = render(route);
    session.previous();
    session = render(route);
    expect(session.currentCard?.front).toBe('Edited front');
    expect(session.seenOccurrenceId).toBe(occurrence);
    expect(getCardsByDeck).toHaveBeenCalledTimes(route === 'library' ? 1 : 0);
  });
});
