/**
 * Image Occlusion renderer for Kit.
 *
 * Anki's Image Occlusion cards embed occlusion coordinates as cloze data:
 *   {{c1::image-occlusion:rect:left=.1:top=.2:width=.3:height=.4:oi=1}}
 *
 * After cloze rendering, the card HTML contains:
 *   Front: <span class="cloze">[...]</span>  (data hidden in display:none div)
 *   Back:  <span class="cloze">image-occlusion:rect:left=.1:top=.2:...</span>
 *
 * Anki uses `anki.imageOcclusion.setup()` JavaScript + canvas to draw masks.
 * Kit uses an SVG overlay with viewBox="0 0 1 1" so the 0–1 coordinates from
 * Anki map directly without percentage rounding. SVG elements are also DOM
 * nodes, making them ideal for a future interactive mask editor.
 *
 * This module is a pure function — no React, no DB, no side effects.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OcclusionRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/**
 * Check if card HTML is an Image Occlusion card.
 *
 * @param html - Rendered card HTML.
 * @returns True if the HTML contains IO markers.
 */
export function isImageOcclusionCard(html: string): boolean {
  return html.includes('image-occlusion') && html.includes('image-occlusion-container');
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Extract occlusion rectangles from card HTML.
 *
 * Checks two sources:
 *  1. `data-io-rects` attribute on the hidden `.io-data` div (injected by Kit's
 *     template renderer to preserve rect data lost during front-side cloze rendering)
 *  2. Inline `image-occlusion:rect:...` patterns in the HTML body (e.g. on the back
 *     where cloze rendering reveals the data)
 *
 * @param html - Full card HTML (front or back).
 * @returns Array of normalized rectangle coordinates (0–1 range).
 */
function parseOcclusionRects(html: string): OcclusionRect[] {
  const rects: OcclusionRect[] = [];
  const regex = /image-occlusion:rect:left=([\d.]+):top=([\d.]+):width=([\d.]+):height=([\d.]+)/g;

  // Source 1: data-io-rects attribute (pipe-separated rect specs)
  const dataAttrMatch = /data-io-rects="([^"]+)"/.exec(html);
  if (dataAttrMatch?.[1]) {
    let m: RegExpExecArray | null;
    while ((m = regex.exec(dataAttrMatch[1])) !== null) {
      rects.push({
        left:   parseFloat(m[1]!),
        top:    parseFloat(m[2]!),
        width:  parseFloat(m[3]!),
        height: parseFloat(m[4]!),
      });
    }
    if (rects.length > 0) return rects;
  }

  // Source 2: inline in the HTML body (back side has cloze-revealed data)
  regex.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(html)) !== null) {
    rects.push({
      left:   parseFloat(m[1]!),
      top:    parseFloat(m[2]!),
      width:  parseFloat(m[3]!),
      height: parseFloat(m[4]!),
    });
  }
  return rects;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * Process Image Occlusion card HTML to render masks as an SVG overlay.
 *
 * Replaces the `<canvas>` and `<script>` elements with an SVG that uses
 * `viewBox="0 0 1 1"` so Anki's 0–1 coordinates map directly without any
 * percentage-to-pixel rounding. The SVG is absolutely positioned over the
 * image inside the container.
 *
 * @param html - Rendered card HTML (after media URL rewriting).
 * @param side - 'front' (masks opaque) or 'back' (masks revealed/transparent).
 * @returns HTML with IO masks rendered as an SVG overlay.
 */
export function renderImageOcclusion(
  html: string,
  side: 'front' | 'back',
): string {
  if (!isImageOcclusionCard(html)) return html;

  const rects = parseOcclusionRects(html);
  if (rects.length === 0) return html;

  // Build SVG rect elements — coordinates map 1:1 to Anki's 0–1 range.
  // On the front, inflate each mask by a small amount (0.4% of image size
  // per side) so text at the edges doesn't leak through.
  const PAD = side === 'front' ? 0.004 : 0;
  const svgRects = rects.map((r) => {
    const x = Math.max(0, r.left - PAD);
    const y = Math.max(0, r.top - PAD);
    const w = Math.min(1 - x, r.width + PAD * 2);
    const h = Math.min(1 - y, r.height + PAD * 2);
    const fill = side === 'front' ? '#ff8e8e' : 'none';
    const stroke = side === 'front' ? '#212121' : '#ff8e8e';
    // Use a thin stroke in viewBox units; 0.002 ≈ 0.2% of image dimension
    const strokeWidth = side === 'front' ? '0.002' : '0.003';
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" />`;
  }).join('\n');

  const svg = [
    '<svg class="io-svg-overlay" viewBox="0 0 1 1" preserveAspectRatio="none"',
    ' style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none">',
    svgRects,
    '</svg>',
  ].join('');

  let result = html;

  // Remove the <canvas> element — we use SVG instead
  result = result.replace(/<canvas\b[^>]*id=["']image-occlusion-canvas["'][^>]*>\s*<\/canvas>/gi, '');

  // Remove the <script> block that calls anki.imageOcclusion.setup()
  result = result.replace(/<script[\s\S]*?imageOcclusion[\s\S]*?<\/script>/gi, '');

  // Remove the <div id="err"> placeholder
  result = result.replace(/<div\s+id=["']err["']\s*>\s*<\/div>/gi, '');

  // Remove Anki IO template buttons (Toggle Masks, Hide Masks) — these call
  // toggle_masks() / hide_masks() which don't exist in Kit's context.
  result = result.replace(
    /<button\b[^>]*onclick=["'][^"']*_masks[^"']*["'][^>]*>[\s\S]*?<\/button>/gi,
    '',
  );
  // Also strip the io-buttons container if it's now empty (or was button-only)
  result = result.replace(/<div\b[^>]*id=["']io-buttons["'][^>]*>\s*<\/div>/gi, '');

  // Insert SVG overlay right after the <img> tag inside the container.
  // Container and image styling is handled by CSS in index.css.
  const containerPattern = /(id=["']image-occlusion-container["'][^>]*>[\s\S]*?<img\b[^>]*>)/i;
  if (containerPattern.test(result)) {
    result = result.replace(containerPattern, `$1\n${svg}`);
  }

  return result;
}
