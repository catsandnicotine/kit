/** Resolve a changed edit file to its deck, including native iCloud paths. */
export function deckIdsFromChanges(
  changes: ReadonlyArray<{ path: string; event: string }>,
): string[] {
  const ids = new Set<string>();
  for (const change of changes) {
    if (change.event !== 'added' && change.event !== 'changed') continue;
    // Swift metadata queries return absolute paths; browser adapters use relative paths.
    const relative = change.path.includes('/Documents/Kit/')
      ? change.path.split('/Documents/Kit/')[1] ?? ''
      : change.path;
    const match = relative.match(/^([^/]+)\/edits\/[^/]+\.json$/);
    if (match?.[1]) ids.add(match[1]);
  }
  return [...ids];
}
