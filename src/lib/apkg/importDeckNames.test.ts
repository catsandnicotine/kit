import { describe, expect, it } from 'vitest';
import { getIncomingDeckNames } from './importDeckNames';

describe('import conflict names', () => {
  it('matches the imported leaf instead of the empty Default deck or parent', () => {
    expect(getIncomingDeckNames([{id:'0',name:'Default'},{id:'1',name:'Biology'},{id:'2',name:'Biology::Respiration'}],[{deckId:'2'}])).toEqual(['Respiration']);
  });
  it('uses the same disambiguated names for a multi-deck package', () => {
    expect(getIncomingDeckNames([{id:'1',name:'Biology::Week 1'},{id:'2',name:'Physics::Week 1'}],[{deckId:'1'},{deckId:'2'}])).toEqual(['Biology > Week 1','Physics > Week 1']);
  });
});
