import { describe, expect, it } from 'vitest';
import { mergeJournalEdits, sameJournalBase, snapshotJournal, validateJournalEdit } from './journal';
import type { EditFile } from './types';
import { createEmptyDeckSnapshot } from '../db/deckFactory';

const edit: EditFile = { v:1, hlc:'1700000000000_device-a_0000', deviceId:'device-a', deckId:'deck', ops:[{type:'deck_rename',name:'Name'}] };
describe('exact canonical journal identities', () => {
  it('deduplicates equivalent envelopes regardless of JSON property order', () => {
    const reordered={ ops:edit.ops, deckId:edit.deckId, deviceId:edit.deviceId, hlc:edit.hlc, v:1 as const };
    expect(mergeJournalEdits('deck',[edit],[reordered])).toHaveLength(1);
  });
  it('rejects conflicting identities, foreign owners and unknown operations', () => {
    expect(()=>mergeJournalEdits('deck',[edit],[{...edit,ops:[{type:'deck_rename',name:'Other'}]}])).toThrow('reuse an edit identity');
    expect(()=>validateJournalEdit({...edit,deckId:'foreign'},'deck')).toThrow('could not be verified');
    expect(()=>validateJournalEdit({...edit,ops:[{type:'unknown'}]},'deck')).toThrow('could not be verified');
  });
  it('sorts by identity independently of arrival order', () => {
    const later={...edit,hlc:'1700000001000_device-a_0000'};
    expect(mergeJournalEdits('deck',[later],[edit]).map(item=>item.hlc)).toEqual([edit.hlc,later.hlc]);
  });
  it('does not invent legacy coverage and compares baseline content conservatively', () => {
    const legacy={...createEmptyDeckSnapshot('Deck','deck',1700000000),compactedThrough:edit.hlc};
    const unpacked=snapshotJournal(legacy);
    expect(unpacked.edits).toEqual([]);expect(unpacked.base.compactedThrough).toBe(edit.hlc);
    expect(sameJournalBase(unpacked.base,legacy)).toBe(true);
    expect(sameJournalBase(unpacked.base,{...legacy,compactedThrough:''})).toBe(false);
  });
});
