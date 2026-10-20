import { JESUS_PAINTING_FILES } from '../data/jesusPaintingFiles';

export const JESUS_PAINTING_DECK_ID = 'e0a57e12-0000-4000-8000-000000000001';
const filenames = new Set<string>(JESUS_PAINTING_FILES);

/** List the bundled originals that belong to this optional built-in deck.
 * @param deckId - Deck being displayed or exported.
 * @returns Bundled media filenames, or an empty list for other decks.
 */
export function getBundledPaintingFiles(deckId: string): readonly string[] {
  return deckId === JESUS_PAINTING_DECK_ID ? JESUS_PAINTING_FILES : [];
}

/** Resolve only allowlisted painting media, preserving ordinary deck media behavior.
 * @param deckId - Deck being displayed or exported.
 * @param filename - Bare image filename in the card HTML.
 * @returns Local bundled asset URL, or undefined for other files or decks.
 */
export function getBundledPaintingUrl(deckId: string, filename: string): string | undefined {
  return deckId === JESUS_PAINTING_DECK_ID && filenames.has(filename)
    ? `${import.meta.env.BASE_URL}decks/jesus-paintings/${filename}`
    : undefined;
}
