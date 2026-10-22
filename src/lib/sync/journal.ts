import type { DeckSnapshot, EditFile } from './types';
import { compareHLC, parseHLC } from './hlc';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

/** Validate an immutable edit envelope before it can enter a replay journal.
 * @param value - Parsed JSON from a local or cloud file.
 * @param deckId - Expected deck owner.
 * @returns A typed edit, or throws instead of silently dropping unknown operations.
 */
export function validateJournalEdit(value: unknown, deckId: string): EditFile {
  const edit = value as Partial<EditFile> | null;
  const clock = typeof edit?.hlc === 'string' ? parseHLC(edit.hlc) : null;
  const types = new Set(['review','card_add','card_edit','card_delete','card_suspend','deck_rename','deck_settings','tag_add','tag_rename','tag_delete','deck_tag_add','deck_tag_remove','note_edit']);
  if (!edit || edit.v !== 1 || edit.deckId !== deckId || !clock || clock.deviceId !== edit.deviceId
    || !/^\d{13}_[A-Za-z0-9-]{1,160}_\d{4,}$/.test(edit.hlc!) || !Array.isArray(edit.ops)
    || edit.ops.some(op => !op || typeof op !== 'object' || !types.has(op.type))) throw new Error('A sync journal could not be verified. Its files have been kept.');
  return edit as EditFile;
}

/** Merge exact edit identities in canonical HLC order, rejecting changed identity contents.
 * @param deckId - Deck owner shared by every edit.
 * @param groups - Retained checkpoint, local and remote journal sets.
 * @returns Deduplicated, deterministic edits; no global arrival watermark is used.
 */
export function mergeJournalEdits(deckId: string, ...groups: ReadonlyArray<readonly EditFile[]>): EditFile[] {
  const edits = new Map<string, EditFile>();
  for (const group of groups) for (const candidate of group) {
    const edit = validateJournalEdit(candidate, deckId);
    const previous = edits.get(edit.hlc);
    if (previous && canonical(previous) !== canonical(edit)) throw new Error('Two sync files reuse an edit identity. Both copies have been kept.');
    edits.set(edit.hlc, edit);
  }
  return [...edits.values()].sort((left, right) => compareHLC(left.hlc, right.hlc));
}

/** Unpack a stable replay baseline without changing a legacy snapshot's state.
 * @param snapshot - Current durable snapshot, with optional checkpoint metadata.
 * @returns Stable baseline and exact known edits; legacy coverage is never invented.
 */
export function snapshotJournal(snapshot: DeckSnapshot): { base: DeckSnapshot; edits: EditFile[] } {
  if (snapshot.replay) {
    if (snapshot.replay.v !== 1 || snapshot.replay.base.replay || snapshot.replay.base.deckId !== snapshot.deckId) throw new Error('The sync checkpoint could not be verified.');
    return { base:snapshot.replay.base, edits:mergeJournalEdits(snapshot.deckId, snapshot.replay.edits) };
  }
  const { replay: _replay, ...base } = snapshot;
  void _replay;
  return { base:JSON.parse(JSON.stringify(base)) as DeckSnapshot, edits:[] };
}

/** Compare baseline content before accepting a peer checkpoint's journal.
 * @param left - This device's verified stable baseline.
 * @param right - A peer checkpoint's stable baseline.
 * @returns True only for equivalent baseline content; never replaces local study data.
 */
export function sameJournalBase(left: DeckSnapshot, right: DeckSnapshot): boolean {
  return canonical(left) === canonical(right);
}
