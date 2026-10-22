import { describe, expect, it } from 'vitest';
import type { CardState, ReviewLog } from '../../types';
import { getKitCardProgress, parseKitProgress } from './kitProgress';
import { parseKitCardMetadata } from './kitCardMetadata';

const state: CardState = { cardId:'old-card', due:2000000000, stability:21.5, difficulty:4.25, elapsedDays:3, scheduledDays:14, reps:8, lapses:1, state:'review', lastReview:1999000000, learningStepIndex:0, suspended:true };
const log: ReviewLog = { id:'old-log', cardId:'old-card', rating:'hard', reviewedAt:1999000000, elapsed:3, scheduledDays:14 };

describe('Kit package sidecars', () => {
  it('retains v1 progress compatibility, including older optional scheduling columns', () => {
    const oldState = { ...state, learningStepIndex:undefined, suspended:undefined };
    const parsed = parseKitProgress(JSON.stringify({ version:1, statesByContent:{ 'Front\x1fBack':oldState }, logsByContent:{ 'Front\x1fBack':[log] } }));
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw new Error(parsed.error);
    expect(getKitCardProgress(parsed.data, 'new-numeric-id', 'Front', 'Back')).toEqual({ success:true, data:{ state:{ ...state, learningStepIndex:0, suspended:false }, logs:[log] } });
  });

  it('keeps v2 duplicate-looking cards distinct by their package IDs', () => {
    const other = { ...state, cardId:'other-card', reps:55 };
    const parsed = parseKitProgress(JSON.stringify({ version:2, exportedAt:1900000000, cardsById:{ '123':{ state, logs:[log] }, '124':{ state:other, logs:[] } } }));
    if (!parsed.success) throw new Error(parsed.error);
    expect(getKitCardProgress(parsed.data, '123', 'Same', 'Same')).toEqual({ success:true, data:{ state, logs:[log] } });
    expect(getKitCardProgress(parsed.data, '124', 'Same', 'Same')).toEqual({ success:true, data:{ state:other, logs:[] } });
    expect(getKitCardProgress(parsed.data, '125', 'Same', 'Same').success).toBe(false);
  });

  it.each([
    'not json', '{}', 'null', '[]',
    JSON.stringify({ version:99 }),
    JSON.stringify({ version:1, statesByContent:[], logsByContent:{} }),
    JSON.stringify({ version:1, statesByContent:{ a:{ ...state, reps:-1 } }, logsByContent:{} }),
    JSON.stringify({ version:2, exportedAt:1, cardsById:{ '123':{ state:{ ...state, due:null }, logs:[] } } }),
    JSON.stringify({ version:2, exportedAt:1, cardsById:{ '123':{ state:null, logs:[{ ...log, rating:'mastered' }] } } }),
  ])('rejects malformed or unsupported progress without silent scheduling loss: %s', input => {
    expect(parseKitProgress(input)).toEqual({ success:false, error:expect.stringContaining('could not be read') });
  });

  it('preserves exact multiword tags and separate metadata for identical-looking cards', () => {
    const parsed = parseKitCardMetadata(JSON.stringify({ version:1, cardsById:{ '123':{ tags:['cell membranes', 'Cell_membranes'] }, '124':{ tags:['other twin'] } } }));
    expect(parsed).toEqual({ success:true, data:{ version:1, cardsById:{ '123':{ tags:['cell membranes', 'Cell_membranes'] }, '124':{ tags:['other twin'] } } } });
  });

  it.each(['null', '[]', '{}', 'not json', JSON.stringify({ version:1, cardsById:{ '123':{ tags:['fine', 42] } } }), JSON.stringify({ version:1, cardsById:{ 'not-an-id':{ tags:[] } } })])('rejects malformed card metadata: %s', input => {
    expect(parseKitCardMetadata(input).success).toBe(false);
  });
});
