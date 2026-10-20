/** One Kit mascot shared by the UI and built-in sample cards. */
export const KIT_CAT_PALETTE: Readonly<Record<string, string>> = {
  '1': '#fff7e6', '2': '#ffc685', '3': '#ed9a51', '4': '#b96638',
  '5': '#673b2b', '6': '#fff0d2', '7': '#ed9e9e', '8': '#352a2a', '9': '#bd713d',
};
export const KIT_CAT_GRID = [
  '............................',
  '............................',
  '......5.............5.......',
  '.....225...........245......',
  '.....2225.........2445......',
  '....227225.......237445.....',
  '....2227225.....2334745.....',
  '....2222222222223334445.....',
  '....2299229999999334995.....',
  '....2222122233333134445.....',
  '....2222882333333884445.....',
  '....2222823333333834445.....',
  '....2299236667666334995.....',
  '....222233667766633444425...',
  '....522333666466633444445...',
  '.....553333333333334555445..',
  '.......2333333333335...245..',
  '.......5333666613335...245..',
  '........23366661335....245..',
  '........23366661335....245..',
  '........233666613332222445..',
  '........233666613334444455..',
  '........2446666144455555....',
  '........24445554445.........',
  '.......26665...26665........',
  '.......26665...26665........',
  '.......55555...55555........',
  '............................',
  '............................',
  '............................',
] as const;

/**
 * Render the shared, shaded pixel cat as self-contained card art.
 * @param size - Display height in pixels.
 * @returns Trusted inline SVG with no external media dependency.
 */
export function kitCatSvg(size = 112): string {
  const pixels = KIT_CAT_GRID.flatMap((row, y) => Array.from(row, (shade, x) => shade === '.' ? '' :
    `<rect x="${x}" y="${y}" width="1" height="1" fill="${KIT_CAT_PALETTE[shade]}"/>`)).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 30" width="${size * 28 / 30}" height="${size}" role="img" aria-label="Kit the cat" shape-rendering="crispEdges" style="display:block;margin:12px auto">${pixels}</svg>`;
}

// Fingerprints of Kit's three original built-in drawings. Custom art stays intact.
const LEGACY_ART = [
  { length: 3811, hash: 783323407, replacement: 'kit' },
  { length: 3221, hash: 1768505219, replacement: 'remove' },
  { length: 3036, hash: 785717061, replacement: 'remove' },
];

function artHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return hash >>> 0;
}

/**
 * Hide known stock cat artwork in the built-in sample without editing cards.
 * @param html - Built-in sample card HTML.
 * @returns Card HTML without stock cats; custom drawings survive.
 */
export function refreshBuiltInKitArtwork(html: string): string {
  return html.replace(/<svg\b[\s\S]*?<\/svg>/g, svg => {
    if (svg === kitCatSvg()) return '';
    const match = LEGACY_ART.find(art => art.length === svg.length && art.hash === artHash(svg));
    return match ? '' : svg;
  }).replace('<strong>Import Deck</strong>', '<strong>+ → Import Anki deck</strong>');
}
