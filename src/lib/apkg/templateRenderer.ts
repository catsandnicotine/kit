/**
 * Anki template renderer.
 *
 * Converts a parsed Anki note + note type into rendered front/back HTML strings
 * ready for display in a WebView. Handles the full Anki template language:
 *
 *   {{FieldName}}                 — simple field substitution
 *   {{FrontSide}}                 — renders the question side into the answer
 *   {{cloze:FieldName}}           — cloze deletion rendering
 *   {{#FieldName}}…{{/FieldName}} — conditional block (visible when non-empty)
 *   {{^FieldName}}…{{/FieldName}} — inverted conditional (visible when empty)
 *   {{type:FieldName}}            — text input for typed-answer cards
 *   {{hint:FieldName}}            — collapsible hint
 *   {{Tags}}                      — space-separated note tags
 *
 * This module has ZERO imports from React, UI, or platform code.
 *
 * @see https://docs.ankiweb.net/templates/fields.html
 */

import type { ParsedNote, ParsedNoteType } from './parser';
import type { Result } from '../../types';

// ---------------------------------------------------------------------------
// Output type
// ---------------------------------------------------------------------------

/**
 * Fully-rendered HTML for both sides of an Anki card.
 * Each string is a self-contained HTML fragment with an embedded
 * `<style>` tag for the note type's CSS.
 */
export interface RenderedCard {
  /** Front (question) HTML, with CSS injected. */
  front: string;
  /** Back (answer) HTML, with CSS injected. */
  back: string;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/** Field name → HTML value mapping used throughout rendering. */
type FieldMap = Record<string, string>;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Render the front and back HTML for one card generated from a note.
 *
 * The `templateIndex` must correspond to an entry in `noteType.templates`.
 * For cloze note types, templateIndex 0 = cloze {{c1::…}},
 * templateIndex 1 = cloze {{c2::…}}, and so on.
 *
 * @param note          - The source Anki note with field values.
 * @param noteType      - The note type that owns the template and CSS.
 * @param templateIndex - Zero-based index into `noteType.templates`.
 * @returns Rendered front and back HTML, or an error if the index is invalid.
 */
export function renderTemplate(
  note: ParsedNote,
  noteType: ParsedNoteType,
  templateIndex: number,
): Result<RenderedCard> {
  if (templateIndex < 0 || templateIndex >= noteType.templates.length) {
    return {
      success: false,
      error: `Template index ${templateIndex} is out of range (note type "${noteType.name}" has ${noteType.templates.length} template(s))`,
    };
  }

  const template  = noteType.templates[templateIndex]!;
  const fieldMap  = buildFieldMap(note, noteType);
  const clozeNum  = templateIndex + 1; // cloze numbers are 1-based
  const styleTag  = noteType.css ? `<style>${noteType.css}</style>` : '';

  // Render front first; the back can reference it via {{FrontSide}}
  const frontBody = processTemplate(template.qfmt, fieldMap, clozeNum, 'front', '');
  const backBody  = processTemplate(template.afmt, fieldMap, clozeNum, 'back', frontBody);

  return {
    success: true,
    data: {
      front: styleTag + frontBody,
      back:  styleTag + backBody,
    },
  };
}

// ---------------------------------------------------------------------------
// Exported helpers — available for unit testing and for the import layer
// ---------------------------------------------------------------------------

/**
 * Build a field-name → value map from a note and its note type.
 * Adds the `Tags` pseudo-field as a space-separated tag string.
 *
 * @param note     - Source note.
 * @param noteType - Note type that defines the ordered field names.
 * @returns Map of field name to its HTML value.
 */
export function buildFieldMap(note: ParsedNote, noteType: ParsedNoteType): FieldMap {
  const map: FieldMap = {};
  for (let i = 0; i < noteType.fields.length; i++) {
    const fieldName = noteType.fields[i];
    if (fieldName !== undefined) {
      map[fieldName] = note.fields[i] ?? '';
    }
  }
  // Special pseudo-fields
  map['Tags']    = note.tags.join(' ');
  map['Type']    = noteType.name;
  map['Subdeck'] = '';   // deck context not available at render time
  map['Deck']    = '';
  map['CardFlag'] = '';
  return map;
}

/**
 * Expand conditional blocks in a template string.
 *
 * `{{#Field}}…{{/Field}}` — rendered if Field is non-empty (after trimming).
 * `{{^Field}}…{{/Field}}` — rendered if Field IS empty.
 *
 * Processes in a loop until stable to correctly handle nested blocks
 * (the innermost pair is always resolved first by the non-greedy regex).
 *
 * @param template - Raw template string.
 * @param fieldMap - Field name → value map.
 * @returns Template with all conditional blocks evaluated and replaced.
 */
export function expandConditionals(template: string, fieldMap: FieldMap): string {
  let result = template;
  let previous = '';

  while (result !== previous) {
    previous = result;

    // {{#Field}}…{{/Field}} — show if field is non-empty
    result = result.replace(
      /\{\{#([^}]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g,
      (_, name: string, content: string) =>
        (fieldMap[name.trim()] ?? '').trim() ? content : '',
    );

    // {{^Field}}…{{/Field}} — show if field IS empty
    result = result.replace(
      /\{\{\^([^}]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g,
      (_, name: string, content: string) =>
        (fieldMap[name.trim()] ?? '').trim() ? '' : content,
    );
  }

  return result;
}

/**
 * Render the Anki cloze deletion markers inside a field value.
 *
 * Cloze markers have the form `{{cN::answer}}` or `{{cN::answer::hint}}`.
 *
 * - On the **front** (question), the active cloze (N === clozeNum) is hidden:
 *   `[...]` or `[hint]` wrapped in `<span class="cloze">`.
 * - On the **back** (answer), the active cloze is revealed:
 *   `answer` wrapped in `<span class="cloze">`.
 * - **Inactive** clozes (N ≠ clozeNum) always show the plain answer text.
 *
 * @param fieldValue - Raw field HTML that may contain `{{cN::…}}` markers.
 * @param clozeNum   - The 1-based cloze number for the current template.
 * @param side       - 'front' (hide active) or 'back' (reveal active).
 * @returns Field HTML with cloze markers replaced by rendered spans.
 */
export function renderClozeField(
  fieldValue: string,
  clozeNum: number,
  side: 'front' | 'back',
): string {
  // Matches {{cN::answer}} and {{cN::answer::hint}}
  // Non-greedy so it handles multiple cloze markers in one field value.
  return fieldValue.replace(
    /\{\{c(\d+)::([\s\S]+?)(?:::([\s\S]+?))?\}\}/g,
    (_, numStr: string, answer: string, hint: string | undefined) => {
      const n = parseInt(numStr, 10);
      if (n === clozeNum) {
        if (side === 'front') {
          const display = hint !== undefined ? hint : '...';
          return `<span class="cloze">[${display}]</span>`;
        }
        return `<span class="cloze">${answer}</span>`;
      }
      // Inactive cloze — reveal the plain answer text
      return answer;
    },
  );
}

// ---------------------------------------------------------------------------
// Core template processor
// ---------------------------------------------------------------------------

/**
 * Process a single template string through the full substitution pipeline.
 *
 * Substitution order (important: each stage must complete before the next):
 *  1. Conditional blocks — `{{#…}}`, `{{^…}}`, `{{/…}}`
 *  2. `{{FrontSide}}` — insert rendered front into back template
 *  3. `{{type:Field}}` — text input element
 *  4. `{{hint:Field}}` — collapsible hint element
 *  5. `{{cloze:Field}}` — cloze rendering
 *  6. `{{Field}}` — plain field substitution (catches everything else)
 *
 * @param template  - Raw template string (qfmt or afmt).
 * @param fieldMap  - Field name → value map.
 * @param clozeNum  - Active cloze number (1-based) for this template.
 * @param side      - Which side is being rendered.
 * @param frontBody - Rendered front body (used only to expand {{FrontSide}}).
 * @returns Rendered HTML string.
 */
function processTemplate(
  template: string,
  fieldMap: FieldMap,
  clozeNum: number,
  side: 'front' | 'back',
  frontBody: string,
): string {
  let result = template;

  // Step 1 — Conditional blocks
  result = expandConditionals(result, fieldMap);

  // Step 2 — {{FrontSide}} (meaningful only on the back)
  if (side === 'back') {
    result = result.replace(/\{\{FrontSide\}\}/g, frontBody);
  }

  // Step 3 — {{type:FieldName}} → text input
  result = result.replace(
    /\{\{type:([^}]+)\}\}/g,
    (_, name: string) =>
      `<input type="text" class="type" data-field="${escapeAttr(name.trim())}" />`,
  );

  // Step 4 — {{hint:FieldName}} → collapsible hint
  result = result.replace(
    /\{\{hint:([^}]+)\}\}/g,
    (_, name: string) => {
      const value = (fieldMap[name.trim()] ?? '').trim();
      if (!value) return '';
      return (
        `<a class="hint" onclick="` +
        `this.style.display='none';` +
        `document.getElementById('hint_${escapeAttr(name.trim())}').style.display='';` +
        `return false;" href="#">Show Hint</a>` +
        `<span id="hint_${escapeAttr(name.trim())}" style="display:none">${value}</span>`
      );
    },
  );

  // Step 5 — {{cloze:FieldName}}
  result = result.replace(
    /\{\{cloze:([^}]+)\}\}/g,
    (_, name: string) => {
      const value = fieldMap[name.trim()] ?? '';
      return renderClozeField(value, clozeNum, side);
    },
  );

  // Step 5.5 — Image Occlusion: inject raw occlusion data as hidden element.
  // On the front, cloze rendering replaces coordinates with "[...]", losing the
  // rect data needed to draw masks. We preserve it in a hidden div so the IO
  // renderer can read it on both sides.
  if (result.includes('image-occlusion-container')) {
    // Find a field that contains image-occlusion rect data
    for (const value of Object.values(fieldMap)) {
      if (value.includes('image-occlusion:rect:')) {
        // Extract just the rect specifications, stripping cloze markers and HTML
        const rectSpecs: string[] = [];
        const ioRegex = /image-occlusion:rect:left=[\d.]+:top=[\d.]+:width=[\d.]+:height=[\d.]+(?::oi=\d+)?/g;
        let ioMatch: RegExpExecArray | null;
        while ((ioMatch = ioRegex.exec(value)) !== null) {
          rectSpecs.push(ioMatch[0]);
        }
        if (rectSpecs.length > 0) {
          const data = rectSpecs.join('|');
          result += `<div class="io-data" style="display:none" data-io-rects="${data}"></div>`;
        }
        break;
      }
    }
  }

  // Step 6 — {{FieldName}} plain substitution
  // At this point all special {{…}} tokens have been consumed.
  // Anything remaining in {{ }} is a field name (or unknown → empty string).
  result = result.replace(
    /\{\{([^{}]+)\}\}/g,
    (_, name: string) => fieldMap[name.trim()] ?? '',
  );

  return result;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Escape a string for safe use inside an HTML attribute value.
 * Replaces `"`, `<`, `>`, and `&` with their HTML entity equivalents.
 *
 * @param s - Raw string.
 * @returns HTML-attribute-safe string.
 */
function escapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
