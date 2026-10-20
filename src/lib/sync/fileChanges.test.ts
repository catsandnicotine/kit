import { describe, expect, it } from 'vitest';
import { deckIdsFromChanges } from './fileChanges';

describe('iCloud edit notifications', () => {
  it('recognizes the absolute paths delivered on an iPhone', () => {
    expect(deckIdsFromChanges([
      { path: '/private/var/mobile/Library/Mobile Documents/iCloud~com~kai~kit/Documents/Kit/deck-a/edits/123.json', event: 'changed' },
      { path: 'deck-b/edits/456.json', event: 'added' },
      { path: 'deck-a/edits/789.json', event: 'added' },
    ])).toEqual(['deck-a', 'deck-b']);
  });

  it('ignores unrelated files, directories, and removals', () => {
    expect(deckIdsFromChanges([
      { path: 'deck-a/snapshot.json', event: 'changed' },
      { path: 'deck-a/edits', event: 'added' },
      { path: 'deck-a/edits/123.json', event: 'removed' },
      { path: '/some-other-app/deck-a/edits/123.json', event: 'changed' },
    ])).toEqual([]);
  });
});
