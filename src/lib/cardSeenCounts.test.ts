import { describe, expect, it } from 'vitest';
import { cardSeenCloudPath, cardSeenRemotePath, mergeCardSeenComponent, mergeCardSeenSession, parseCardSeenComponent, parseCardSeenSession, sumCardSeen } from './cardSeenCounts';
import type { CardSeenComponent, CardSeenSession } from '../types/cardSeen';

const component: CardSeenComponent = { v:1, kind:'total', deckId:'deck-a', deviceId:'device-a', counts:{ 'card-a':2 } };
const session: CardSeenSession = { v:1, kind:'session', deckId:'deck-a', deviceId:'device-a', sessionId:'11111111-1111-4111-8111-111111111111', mode:'study', counts:{ 'card-a':1 }, occurrences:{ first:'card-a' } };

describe('sparse seen-count components', () => {
  it('merges one writer by MAX and sums independent devices without mutating either', () => {
    const incoming = { ...component, counts:{ 'card-a':1, 'card-b':4 } };
    const merged = mergeCardSeenComponent(component, incoming);
    expect(merged.counts).toEqual({ 'card-a':2, 'card-b':4 });
    expect(component.counts).toEqual({ 'card-a':2 });
    expect(sumCardSeen([merged, { ...component, deviceId:'device-b', counts:{ 'card-a':3 } }], 'card-a')).toBe(5);
    expect(mergeCardSeenComponent(merged, merged)).toEqual(merged);
  });

  it('merges reset observations by writer maxima without lowering lifetime components', () => {
    const first: CardSeenComponent = { ...component, resets:{ 'card-a':{ 'device-a':2, 'device-b':3 } } };
    const later: CardSeenComponent = { ...component, counts:{ 'card-a':4 }, resets:{ 'card-a':{ 'device-a':1, 'device-c':2 } } };
    const merged = mergeCardSeenComponent(first, later);
    expect(merged.resets).toEqual({ 'card-a':{ 'device-a':2, 'device-b':3, 'device-c':2 } });
    expect(first.resets).toEqual({ 'card-a':{ 'device-a':2, 'device-b':3 } });
    const other: CardSeenComponent = { ...component, deviceId:'device-b', counts:{ 'card-a':5 }, resets:{ 'card-a':{ 'device-a':3 } } };
    expect(sumCardSeen([merged, other], 'card-a')).toBe(3);
    expect(sumCardSeen([other, merged], 'card-a')).toBe(3);
    expect(mergeCardSeenComponent(merged, first)).toEqual(merged);
    expect(parseCardSeenComponent(JSON.stringify(merged), 'deck-a', 'device-a')).toEqual(merged);
    expect(parseCardSeenComponent(JSON.stringify(component), 'deck-a', 'device-a')).toEqual(component);
  });

  it('keeps an observed reset when its writer component is late or stale', () => {
    const reset: CardSeenComponent = { ...component, counts:{}, resets:{ 'card-a':{ 'device-b':3 } } };
    expect(sumCardSeen([reset], 'card-a')).toBe(0);
    expect(sumCardSeen([reset, { ...component, deviceId:'device-b', counts:{ 'card-a':1 } }], 'card-a')).toBe(0);
    expect(sumCardSeen([reset, { ...component, deviceId:'device-b', counts:{ 'card-a':4 } }], 'card-a')).toBe(1);
  });

  it.each([null, [], { 'constructor':{} }, { 'card-a':null }, { 'card-a':{ 'constructor':1 } }, { 'card-a':{ 'device-a':-1 } }].map(resets => ({ resets })))('rejects malformed reset observations $resets', ({ resets }) => {
    expect(() => parseCardSeenComponent(JSON.stringify({ ...component, resets }), 'deck-a', 'device-a')).toThrow();
  });

  it.each([NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '3'])('rejects malformed count %s without resetting it', count => {
    expect(() => parseCardSeenComponent(JSON.stringify({ ...component, counts:{ 'card-a':count } }), 'deck-a', 'device-a')).toThrow();
  });

  it('rejects foreign owners and object-prototype aliases', () => {
    expect(() => parseCardSeenComponent(JSON.stringify(component), 'another-deck', 'device-a')).toThrow();
    expect(() => parseCardSeenComponent(JSON.stringify(component), 'deck-a', 'another-device')).toThrow();
    for (const key of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      expect(() => parseCardSeenComponent(JSON.stringify({ ...component, counts:Object.fromEntries([[key, 1]]) }), 'deck-a', 'device-a')).toThrow();
      expect(() => parseCardSeenSession(JSON.stringify({ ...session, occurrences:Object.fromEntries([[key, 'card-a']]) }), 'deck-a', session.sessionId)).toThrow();
    }
    expect(sumCardSeen([component], 'constructor')).toBe(0);
  });

  it('unions session occurrences idempotently and rejects changed card/mode identity', () => {
    const later: CardSeenSession = { ...session, counts:{ 'card-b':1 }, occurrences:{ second:'card-b' } };
    const merged = mergeCardSeenSession(session, later);
    expect(merged.counts).toEqual({ 'card-a':1, 'card-b':1 });
    expect(mergeCardSeenSession(merged, session)).toEqual(merged);
    expect(() => mergeCardSeenSession(session, { ...session, occurrences:{ first:'card-b' } })).toThrow();
    expect(() => mergeCardSeenSession(session, { ...session, mode:'practice' })).toThrow();
    expect(() => parseCardSeenSession(JSON.stringify({ ...session, counts:{ 'card-a':99 } }), 'deck-a', session.sessionId)).toThrow();
  });

  it('recognizes only separate owned files, including native absolute paths', () => {
    expect(cardSeenRemotePath('deck-a/seen-v1/device-b.json')).toEqual({ deckId:'deck-a', kind:'total', id:'device-b', localPath:'deck-a/device-b.json' });
    expect(cardSeenRemotePath(`/private/iCloud/Documents/Kit/deck-a/seen-v1/sessions/${session.sessionId}.json`)?.kind).toBe('session');
    expect(cardSeenCloudPath(`deck-a/sessions/${session.sessionId}.json`)).toBe(`deck-a/seen-v1/sessions/${session.sessionId}.json`);
    for (const path of ['deck-a/snapshot.json', 'deck-a/edits/123.json', 'deck-a/seen-v1/a.json.bak', '../seen-v1/device.json', 'deck-a/seen-v1/sessions/not-a-uuid.json']) expect(cardSeenRemotePath(path)).toBeNull();
  });
});
