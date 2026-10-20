/**
 * Strip Anki's hierarchical `::` prefixes from deck names, keeping the leaf.
 * If stripping creates duplicates, keep enough parent context to disambiguate.
 *
 * "A::B::C" → "C"
 * If both "A::B::Cards" and "X::Y::Cards" exist → "B > Cards" and "Y > Cards"
 *
 * @param names - Full hierarchical deck names.
 * @returns Array of display names in the same order.
 */
export function resolveLeafNames(names: string[]): string[] {
  // Start with just the leaf segment
  const leaves = names.map((n) => {
    const parts = n.split('::');
    return parts[parts.length - 1]?.trim() ?? n;
  });

  // Check for duplicates and add parent context where needed
  const seen = new Map<string, number[]>();
  for (let i = 0; i < leaves.length; i++) {
    const leaf = leaves[i]!;
    const indices = seen.get(leaf) ?? [];
    indices.push(i);
    seen.set(leaf, indices);
  }

  for (const [, indices] of seen) {
    if (indices.length <= 1) continue;
    // Collision — use "Parent > Leaf" format
    for (const idx of indices) {
      const parts = names[idx]!.split('::');
      if (parts.length >= 2) {
        leaves[idx] = `${parts[parts.length - 2]!.trim()} > ${parts[parts.length - 1]!.trim()}`;
      }
    }
  }

  return leaves;
}


/** Use only decks that actually contain cards; Anki often puts empty Default/parents first.
 * @param decks - Parsed deck metadata.
 * @param cards - Parsed cards identifying the decks that will be imported.
 * @returns The same names used when creating the imported decks.
 */
export function getIncomingDeckNames(decks: readonly {id:string;name:string}[], cards: readonly {deckId:string}[]): string[] {
  const used = new Set(cards.map(card => card.deckId));
  return resolveLeafNames(decks.filter(deck => used.has(deck.id)).map(deck => deck.name));
}
