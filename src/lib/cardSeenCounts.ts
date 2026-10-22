import type { CardSeenComponent, CardSeenRemotePath, CardSeenSession } from '../types/cardSeen';

/** Validate a single path-safe owner/card identifier.
 * @param value - Untrusted identifier.
 * @returns Whether the value can be used as one identifier segment.
 */
export function isCardSeenId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value) && !Object.prototype.hasOwnProperty.call(Object.prototype, value);
}

/** Validate a session-local idempotency key without object-prototype aliases.
 * @param value - Captured occurrence key, never used as a file path.
 * @returns Whether it is a bounded, ordinary text key.
 */
export function isCardSeenOccurrence(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256
    && !Object.prototype.hasOwnProperty.call(Object.prototype, value)
    && ![...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
}

/** Validate the UUID assigned to one viewing session.
 * @param value - Untrusted session identifier.
 * @returns Whether the identifier is a UUID.
 */
export function isCardSeenSessionId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseCounts(value: unknown): Record<string, number> {
  if (!object(value)) throw new Error('Saved viewing counts could not be read. Your cards are unchanged.');
  const entries = Object.entries(value);
  if (entries.some(([key, count]) => !isCardSeenId(key) || key === '__proto__' || typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0)) {
    throw new Error('Saved viewing counts could not be read. Your cards are unchanged.');
  }
  return Object.fromEntries(entries) as Record<string, number>;
}

function parseResets(value: unknown): Record<string, Record<string, number>> {
  if (!object(value)) throw new Error('Saved viewing-count resets could not be read. Your cards are unchanged.');
  return Object.fromEntries(Object.entries(value).map(([cardId, writers]) => {
    if (!isCardSeenId(cardId)) throw new Error('Saved viewing-count reset has an invalid card.');
    return [cardId, parseCounts(writers)];
  }));
}

/** Parse a count component without accepting another deck or filename's identity.
 * @param raw - Serialized count component.
 * @param deckId - Expected deck owner.
 * @param deviceId - Expected component writer.
 * @returns A validated component; malformed data throws and must not be overwritten.
 */
export function parseCardSeenComponent(raw: string, deckId: string, deviceId: string): CardSeenComponent {
  const value: unknown = JSON.parse(raw);
  if (!object(value) || value.v !== 1 || value.kind !== 'total' || value.deckId !== deckId || value.deviceId !== deviceId || !isCardSeenId(deckId) || !isCardSeenId(deviceId)) {
    throw new Error('Saved viewing counts belong to an unexpected file. Your cards are unchanged.');
  }
  return { v:1, kind:'total', deckId, deviceId, counts:parseCounts(value.counts), ...(value.resets === undefined ? {} : { resets:parseResets(value.resets) }) };
}

/** Parse one session, preserving its count/occurrence relationship.
 * @param raw - Serialized session document.
 * @param deckId - Expected deck owner.
 * @param sessionId - Expected UUID filename.
 * @returns A validated session; malformed or foreign data throws.
 */
export function parseCardSeenSession(raw: string, deckId: string, sessionId: string): CardSeenSession {
  const value: unknown = JSON.parse(raw);
  if (!object(value) || value.v !== 1 || value.kind !== 'session' || value.deckId !== deckId || value.sessionId !== sessionId
    || !isCardSeenId(deckId) || !isCardSeenId(value.deviceId) || !isCardSeenSessionId(sessionId)
    || (value.mode !== 'study' && value.mode !== 'practice') || !object(value.occurrences)) {
    throw new Error('Saved viewing session could not be read. Your cards are unchanged.');
  }
  const entries = Object.entries(value.occurrences);
  if (entries.some(([key, card]) => !isCardSeenOccurrence(key) || !isCardSeenId(card))) {
    throw new Error('Saved viewing session contains an invalid occurrence.');
  }
  const occurrences = Object.fromEntries(entries) as Record<string, string>;
  const counts = parseCounts(value.counts);
  const computed = Object.create(null) as Record<string, number>;
  for (const cardId of Object.values(occurrences)) computed[cardId] = (computed[cardId] ?? 0) + 1;
  if (Object.keys(counts).length !== Object.keys(computed).length || Object.entries(computed).some(([card, count]) => counts[card] !== count)) {
    throw new Error('Saved viewing session counts do not match its occurrences.');
  }
  return { v:1, kind:'session', deckId, deviceId:value.deviceId, sessionId, mode:value.mode, counts, occurrences };
}

/** Merge one writer's absolute totals so replay/reordered cloud echoes never add twice.
 * @param current - Existing component for the same deck and device.
 * @param incoming - Incoming component for that exact owner.
 * @returns Componentwise maxima without mutating either input.
 */
export function mergeCardSeenComponent(current: CardSeenComponent, incoming: CardSeenComponent): CardSeenComponent {
  if (current.deckId !== incoming.deckId || current.deviceId !== incoming.deviceId) throw new Error('Viewing count owners do not match.');
  const counts = { ...current.counts };
  for (const [card, count] of Object.entries(incoming.counts)) counts[card] = Math.max(counts[card] ?? 0, count);
  const resets = { ...current.resets };
  for (const [card, writers] of Object.entries(incoming.resets ?? {})) {
    const observed = { ...resets[card] };
    for (const [writer, baseline] of Object.entries(writers)) observed[writer] = Math.max(observed[writer] ?? 0, baseline);
    resets[card] = observed;
  }
  return { ...current, counts, ...(current.resets || incoming.resets ? { resets } : {}) };
}

/** Merge idempotent occurrences from two copies of the same session.
 * @param current - Previously cached session document.
 * @param incoming - Another copy of the identical session.
 * @returns The occurrence union and recomputed sparse session totals.
 */
export function mergeCardSeenSession(current: CardSeenSession, incoming: CardSeenSession): CardSeenSession {
  if (current.deckId !== incoming.deckId || current.deviceId !== incoming.deviceId || current.sessionId !== incoming.sessionId || current.mode !== incoming.mode) throw new Error('Viewing session owners do not match.');
  const occurrences = { ...current.occurrences };
  for (const [occurrence, card] of Object.entries(incoming.occurrences)) {
    if (occurrences[occurrence] !== undefined && occurrences[occurrence] !== card) throw new Error('A viewing occurrence belongs to another card.');
    occurrences[occurrence] = card;
  }
  const counts = Object.create(null) as Record<string, number>;
  for (const card of Object.values(occurrences)) counts[card] = (counts[card] ?? 0) + 1;
  return { ...current, occurrences, counts };
}

/** Sum independent writer counts above all observed reset baselines for one card.
 * @param components - Validated device components in one deck.
 * @param cardId - Card whose lifetime total is needed.
 * @returns Answer reveals since the latest observed resets; unseen offline reveals can arrive later.
 */
export function sumCardSeen(components: Iterable<CardSeenComponent>, cardId: string): number {
  const writers = new Map<string, number>();
  const resets = new Map<string, number>();
  for (const component of components) {
    const own = Object.prototype.hasOwnProperty.call(component.counts, cardId) ? component.counts[cardId]! : 0;
    writers.set(component.deviceId, Math.max(writers.get(component.deviceId) ?? 0, own));
    const observed = Object.prototype.hasOwnProperty.call(component.resets ?? {}, cardId) ? component.resets![cardId]! : {};
    for (const [writer, baseline] of Object.entries(observed)) resets.set(writer, Math.max(resets.get(writer) ?? 0, baseline));
  }
  let count = 0;
  for (const [writer, total] of writers) count += Math.max(0, total - (resets.get(writer) ?? 0));
  if (!Number.isSafeInteger(count)) throw new Error('Viewing count is outside the supported integer range.');
  return count;
}

/** Recognize only count-owned cloud files, leaving scheduler edits on their own path.
 * @param path - Relative sync path or absolute iCloud Documents/Kit path.
 * @returns The safe file owner and corresponding local relative path, or null.
 */
export function cardSeenRemotePath(path: string): CardSeenRemotePath | null {
  const relative = path.includes('/Documents/Kit/') ? path.split('/Documents/Kit/')[1] ?? '' : path;
  const match = relative.match(/^([A-Za-z0-9_-]{1,160})\/seen-v1\/(?:sessions\/([0-9a-f-]+)|([A-Za-z0-9_-]{1,160}))\.json$/i);
  if (!match?.[1]) return null;
  const deckId = match[1];
  if (match[2] && isCardSeenSessionId(match[2])) return { deckId, kind:'session', id:match[2], localPath:`${deckId}/sessions/${match[2]}.json` };
  if (match[3]) return { deckId, kind:'total', id:match[3], localPath:`${deckId}/${match[3]}.json` };
  return null;
}

/** Convert a count-owned local relative path to its distinct cloud folder.
 * @param path - Validated local component/session path.
 * @returns Cloud relative path, throwing for unrelated file paths.
 */
export function cardSeenCloudPath(path: string): string {
  const first = path.indexOf('/');
  const cloud = `${path.slice(0, first)}/seen-v1/${path.slice(first + 1)}`;
  if (first < 1 || !cardSeenRemotePath(cloud)) throw new Error('Invalid viewing-count path.');
  return cloud;
}
