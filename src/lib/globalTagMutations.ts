import { applyTagMutations, hasTagUsage } from './db/queries';
import type { GlobalTagMutationPorts, TagMutationOp } from '../types/tagMutations';

function name(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || [...trimmed].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) throw new Error('Enter a tag name.');
  return trimmed;
}

/** Propagate exact-name tag changes through durable per-deck edits before updating the catalogue.
 * @param ports - Deck access, durable edit queue and catalogue persistence.
 * @returns Serialized mutations; failures remain visible and can be retried idempotently.
 */
export function createGlobalTagMutations(ports: GlobalTagMutationPorts) {
  let serial: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
    const task = serial.then(work);
    serial = task.catch(() => {});
    return task;
  };
  const apply = async (tag: string, ops: TagMutationOp[]) => {
    // Open and validate every deck first: an unavailable deck must not produce
    // a successful catalogue-only edit that leaves its cards behind.
    const affected = [];
    for (const deckId of [...new Set(ports.deckIds())]) {
      const db = await ports.openDeck(deckId);
      if (!db) throw new Error('A deck could not be opened. Try again when all decks are available.');
      const usage = hasTagUsage(db, tag);
      if (!usage.success) throw new Error('A deck’s tags could not be read. Your tag change has not finished.');
      if (usage.data) affected.push({ deckId, db });
    }
    for (const { deckId, db } of affected) {
      if (!await ports.writeEdit(deckId, ops)) throw new Error('Could not save the tag change. Some decks may already be updated; try again.');
      const now = Math.floor(Date.now() / 1000);
      const result = applyTagMutations(db, deckId, ops, now);
      if (!result.success) throw new Error('Could not finish updating a deck’s tags. The saved change can be retried.');
    }
  };
  const catalog = () => new Map(ports.getCatalog().map(tag => [tag.name, { ...tag }]));
  return {
    rename(oldValue: string, newValue: string) {
      return enqueue(async () => {
        const oldTag = name(oldValue), newTag = name(newValue);
        if (oldTag === newTag) return;
        const tags = catalog();
        const color = tags.get(newTag)?.color ?? tags.get(oldTag)?.color ?? '';
        await apply(oldTag, [{ type:'tag_rename', oldTag, newTag }, { type:'tag_add', tag:newTag, color }]);
        tags.delete(oldTag); tags.set(newTag, { name:newTag, color });
        await ports.saveCatalog([...tags.values()]);
      });
    },
    remove(value: string) {
      return enqueue(async () => {
        const tag = name(value);
        const tags = catalog();
        await apply(tag, [{ type:'tag_delete', tag }]);
        tags.delete(tag);
        await ports.saveCatalog([...tags.values()]);
      });
    },
    upsert(value: string, color: string) {
      return enqueue(async () => {
        const tag = name(value);
        const tags = catalog();
        await apply(tag, [{ type:'tag_add', tag, color }]);
        tags.set(tag, { name:tag, color });
        await ports.saveCatalog([...tags.values()]);
      });
    },
    mergeImported(imported: Array<{ tag: string; color: string }>) {
      return enqueue(async () => {
        const tags = catalog();
        for (const entry of imported) if (entry.tag && !tags.has(entry.tag)) tags.set(entry.tag, { name:entry.tag, color:entry.color });
        await ports.saveCatalog([...tags.values()]);
      });
    },
  };
}
