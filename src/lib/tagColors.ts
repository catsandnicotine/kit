/**
 * Tag color palette for Kit.
 *
 * 8 color families × 5 shades = 40 colors, arranged in rainbow order.
 * All colors are chosen to be legible on both light and dark backgrounds
 * when used as pill backgrounds with white or dark text.
 */

export interface TagColorShade {
  /** Display name of this specific shade, e.g. "Rose". */
  name: string;
  /** Hex color value, e.g. "#FF3B30". */
  hex: string;
  /** Family name used as a section header, e.g. "Red". */
  family: string;
  /** Rainbow order index of the family (0 = Red … 7 = Pink). */
  familyIndex: number;
  /** Index within the family (0 = lightest … 4 = darkest). */
  shadeIndex: number;
}

/** All 40 tag color shades in rainbow + shade order. */
export const TAG_PALETTE: TagColorShade[] = [
  // ── Red ────────────────────────────────────────────────────────────────
  { name: 'Rose',     hex: '#FFB3BA', family: 'Red',    familyIndex: 0, shadeIndex: 0 },
  { name: 'Coral',    hex: '#FF6B6B', family: 'Red',    familyIndex: 0, shadeIndex: 1 },
  { name: 'Red',      hex: '#FF3B30', family: 'Red',    familyIndex: 0, shadeIndex: 2 },
  { name: 'Crimson',  hex: '#C0392B', family: 'Red',    familyIndex: 0, shadeIndex: 3 },
  { name: 'Maroon',   hex: '#7B1E1E', family: 'Red',    familyIndex: 0, shadeIndex: 4 },
  // ── Orange ─────────────────────────────────────────────────────────────
  { name: 'Peach',    hex: '#FFCBA4', family: 'Orange', familyIndex: 1, shadeIndex: 0 },
  { name: 'Apricot',  hex: '#FF9F6B', family: 'Orange', familyIndex: 1, shadeIndex: 1 },
  { name: 'Orange',   hex: '#FF9500', family: 'Orange', familyIndex: 1, shadeIndex: 2 },
  { name: 'Tangerine',hex: '#D4600A', family: 'Orange', familyIndex: 1, shadeIndex: 3 },
  { name: 'Rust',     hex: '#8B3A00', family: 'Orange', familyIndex: 1, shadeIndex: 4 },
  // ── Yellow ─────────────────────────────────────────────────────────────
  { name: 'Cream',    hex: '#FFF3B0', family: 'Yellow', familyIndex: 2, shadeIndex: 0 },
  { name: 'Lemon',    hex: '#FFE066', family: 'Yellow', familyIndex: 2, shadeIndex: 1 },
  { name: 'Yellow',   hex: '#FFCC00', family: 'Yellow', familyIndex: 2, shadeIndex: 2 },
  { name: 'Gold',     hex: '#C8960C', family: 'Yellow', familyIndex: 2, shadeIndex: 3 },
  { name: 'Amber',    hex: '#7A5900', family: 'Yellow', familyIndex: 2, shadeIndex: 4 },
  // ── Green ──────────────────────────────────────────────────────────────
  { name: 'Mint',     hex: '#A8F0C6', family: 'Green',  familyIndex: 3, shadeIndex: 0 },
  { name: 'Lime',     hex: '#5DD97A', family: 'Green',  familyIndex: 3, shadeIndex: 1 },
  { name: 'Green',    hex: '#34C759', family: 'Green',  familyIndex: 3, shadeIndex: 2 },
  { name: 'Forest',   hex: '#1A7A38', family: 'Green',  familyIndex: 3, shadeIndex: 3 },
  { name: 'Emerald',  hex: '#0A4020', family: 'Green',  familyIndex: 3, shadeIndex: 4 },
  // ── Cyan ───────────────────────────────────────────────────────────────
  { name: 'Ice',      hex: '#B3EEF8', family: 'Cyan',   familyIndex: 4, shadeIndex: 0 },
  { name: 'Sky',      hex: '#5AC8FA', family: 'Cyan',   familyIndex: 4, shadeIndex: 1 },
  { name: 'Cyan',     hex: '#00BCD4', family: 'Cyan',   familyIndex: 4, shadeIndex: 2 },
  { name: 'Teal',     hex: '#00838F', family: 'Cyan',   familyIndex: 4, shadeIndex: 3 },
  { name: 'Petrol',   hex: '#00474F', family: 'Cyan',   familyIndex: 4, shadeIndex: 4 },
  // ── Blue ───────────────────────────────────────────────────────────────
  { name: 'Powder',   hex: '#AED6F1', family: 'Blue',   familyIndex: 5, shadeIndex: 0 },
  { name: 'Azure',    hex: '#5BA4E0', family: 'Blue',   familyIndex: 5, shadeIndex: 1 },
  { name: 'Blue',     hex: '#007AFF', family: 'Blue',   familyIndex: 5, shadeIndex: 2 },
  { name: 'Cobalt',   hex: '#0047AB', family: 'Blue',   familyIndex: 5, shadeIndex: 3 },
  { name: 'Navy',     hex: '#001F5B', family: 'Blue',   familyIndex: 5, shadeIndex: 4 },
  // ── Purple ─────────────────────────────────────────────────────────────
  { name: 'Lavender', hex: '#D7B8F3', family: 'Purple', familyIndex: 6, shadeIndex: 0 },
  { name: 'Lilac',    hex: '#B07FDC', family: 'Purple', familyIndex: 6, shadeIndex: 1 },
  { name: 'Purple',   hex: '#AF52DE', family: 'Purple', familyIndex: 6, shadeIndex: 2 },
  { name: 'Violet',   hex: '#6B2FA0', family: 'Purple', familyIndex: 6, shadeIndex: 3 },
  { name: 'Plum',     hex: '#3B0764', family: 'Purple', familyIndex: 6, shadeIndex: 4 },
  // ── Pink ───────────────────────────────────────────────────────────────
  { name: 'Blush',    hex: '#FFB3C6', family: 'Pink',   familyIndex: 7, shadeIndex: 0 },
  { name: 'Salmon',   hex: '#FF7096', family: 'Pink',   familyIndex: 7, shadeIndex: 1 },
  { name: 'Pink',     hex: '#FF2D55', family: 'Pink',   familyIndex: 7, shadeIndex: 2 },
  { name: 'Magenta',  hex: '#C01048', family: 'Pink',   familyIndex: 7, shadeIndex: 3 },
  { name: 'Fuchsia',  hex: '#7A0030', family: 'Pink',   familyIndex: 7, shadeIndex: 4 },
];

/** Family names in rainbow order. */
export const TAG_FAMILIES = ['Red', 'Orange', 'Yellow', 'Green', 'Cyan', 'Blue', 'Purple', 'Pink'] as const;

/** Lookup a shade by hex (case-insensitive). */
const _hexMap = new Map<string, TagColorShade>(
  TAG_PALETTE.map(s => [s.hex.toLowerCase(), s]),
);

/**
 * Get the color shade entry for a hex value, or null if not in the palette.
 *
 * @param hex - Hex color string (e.g. '#FF3B30').
 */
export function getColorShade(hex: string): TagColorShade | null {
  return _hexMap.get(hex.toLowerCase()) ?? null;
}

/**
 * Get the family name for a hex value, or null if not in the palette.
 *
 * @param hex - Hex color string.
 */
export function getColorFamily(hex: string): string | null {
  return _hexMap.get(hex.toLowerCase())?.family ?? null;
}

/**
 * Get the sort key for a hex (familyIndex * 10 + shadeIndex), or -1 if no color.
 *
 * @param hex - Hex color string, or empty string for uncolored.
 */
export function getColorSortKey(hex: string): number {
  if (!hex) return -1;
  const shade = _hexMap.get(hex.toLowerCase());
  return shade ? shade.familyIndex * 10 + shade.shadeIndex : -1;
}

/**
 * Return the CSS text color for a colored pill background.
 * Uses relative luminance threshold.
 *
 * @param hex - Background color hex.
 * @returns CSS color string — '#1c1c1e' for light backgrounds, '#ffffff' for dark.
 */
export function pillTextColor(hex: string): '#1c1c1e' | '#ffffff' {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.55 ? '#1c1c1e' : '#ffffff';
}
