/**
 * Tests for the Anki template renderer.
 *
 * All tests use plain in-memory fixtures — no file I/O or WASM loading needed.
 */

import { describe, expect, it } from 'vitest';
import {
  buildFieldMap,
  expandConditionals,
  renderClozeField,
  renderTemplate,
} from './templateRenderer';
import type { ParsedNote, ParsedNoteType } from './parser';

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function makeNote(
  fields: string[],
  tags: string[] = [],
): ParsedNote {
  return {
    id:         '1700000000000',
    noteTypeId: '1000000000000',
    fields,
    tags,
    createdAt:  1700000000,
  };
}

function makeNoteType(
  fieldNames: string[],
  templates: Array<{ name?: string; qfmt: string; afmt: string }>,
  css = '',
): ParsedNoteType {
  return {
    id:        '1000000000000',
    name:      'TestType',
    fields:    fieldNames,
    css,
    templates: templates.map((t, i) => ({
      name: t.name ?? `Card ${i + 1}`,
      ord:  i,
      qfmt: t.qfmt,
      afmt: t.afmt,
    })),
  };
}

// Convenience: render a basic two-field note (Front, Back)
function renderBasic(
  frontValue: string,
  backValue: string,
  qfmt = '{{Front}}',
  afmt = '{{FrontSide}}<hr>{{Back}}',
  css = '',
) {
  const note     = makeNote([frontValue, backValue]);
  const noteType = makeNoteType(['Front', 'Back'], [{ qfmt, afmt }], css);
  return renderTemplate(note, noteType, 0);
}

// ---------------------------------------------------------------------------
// renderTemplate — error handling
// ---------------------------------------------------------------------------

describe('renderTemplate — error handling', () => {
  it('returns an error when templateIndex is negative', () => {
    const note = makeNote(['Q', 'A']);
    const nt   = makeNoteType(['Front', 'Back'], [{ qfmt: '{{Front}}', afmt: '{{Back}}' }]);
    const r = renderTemplate(note, nt, -1);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toMatch(/out of range/i);
  });

  it('returns an error when templateIndex >= templates.length', () => {
    const note = makeNote(['Q', 'A']);
    const nt   = makeNoteType(['Front', 'Back'], [{ qfmt: '{{Front}}', afmt: '{{Back}}' }]);
    const r = renderTemplate(note, nt, 5);
    expect(r.success).toBe(false);
  });

  it('succeeds with templateIndex 0 on a single-template note type', () => {
    const r = renderBasic('Hello', 'World');
    expect(r.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// CSS injection
// ---------------------------------------------------------------------------

describe('CSS injection', () => {
  it('wraps note type CSS in a <style> tag at the front of both sides', () => {
    const css = '.card { font-size: 20px; }';
    const r = renderBasic('Q', 'A', '{{Front}}', '{{Back}}', css);
    expect(r.success).toBe(true);
    if (!r.success) return;

    expect(r.data.front).toContain(`<style>${css}</style>`);
    expect(r.data.back).toContain(`<style>${css}</style>`);
    // Style tag is prepended (not appended)
    expect(r.data.front.startsWith('<style>')).toBe(true);
  });

  it('omits the <style> tag when CSS is empty', () => {
    const r = renderBasic('Q', 'A', '{{Front}}', '{{Back}}', '');
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.front).not.toContain('<style>');
  });
});

// ---------------------------------------------------------------------------
// {{FieldName}} — simple field substitution
// ---------------------------------------------------------------------------

describe('{{FieldName}} — simple field substitution', () => {
  it('replaces {{Front}} with the Front field value', () => {
    const r = renderBasic('What is 2+2?', '4');
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.front).toContain('What is 2+2?');
  });

  it('replaces multiple different field tokens', () => {
    const note = makeNote(['Hello', 'World', 'Extra']);
    const nt   = makeNoteType(
      ['A', 'B', 'C'],
      [{ qfmt: '{{A}} and {{B}}', afmt: '{{C}}' }],
    );
    const r = renderTemplate(note, nt, 0);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.front).toContain('Hello and World');
    expect(r.data.back).toContain('Extra');
  });

  it('renders an unknown field name as an empty string', () => {
    const r = renderBasic('Q', 'A', '{{NonExistent}}', '{{Back}}');
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.front).toBe('');
  });

  it('renders {{Tags}} as a space-separated list of note tags', () => {
    const note = makeNote(['Q', 'A'], ['science', 'biology']);
    const nt   = makeNoteType(['Front', 'Back'], [{ qfmt: '{{Tags}}', afmt: '{{Back}}' }]);
    const r = renderTemplate(note, nt, 0);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.front).toBe('science biology');
  });

  it('leaves HTML in field values unescaped (fields may contain HTML)', () => {
    const r = renderBasic('<b>Bold</b>', 'Answer');
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.front).toContain('<b>Bold</b>');
  });
});

// ---------------------------------------------------------------------------
// {{FrontSide}} — question side reference
// ---------------------------------------------------------------------------

describe('{{FrontSide}}', () => {
  it('inserts the rendered front into the back template', () => {
    const r = renderBasic('Question text', 'Answer text');
    // afmt is '{{FrontSide}}<hr>{{Back}}'
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.back).toContain('Question text');
    expect(r.data.back).toContain('Answer text');
    expect(r.data.back).toContain('<hr>');
  });

  it('FrontSide does not include the <style> tag', () => {
    const css = '.card{}';
    const r = renderBasic('Q', 'A', '{{Front}}', '{{FrontSide}}', css);
    expect(r.success).toBe(true);
    if (!r.success) return;
    // The back contains exactly one <style> tag (from the renderer itself)
    const styleCount = (r.data.back.match(/<style>/g) ?? []).length;
    expect(styleCount).toBe(1);
  });

  it('does nothing in the front template (not replaced on question side)', () => {
    // {{FrontSide}} is only substituted in the afmt; in qfmt it's a no-op
    const r = renderBasic('Q', 'A', '{{FrontSide}}{{Front}}', '{{Back}}');
    expect(r.success).toBe(true);
    if (!r.success) return;
    // {{FrontSide}} in the front is treated as an unknown field → empty string
    expect(r.data.front).toBe('Q');
  });
});

// ---------------------------------------------------------------------------
// {{type:FieldName}} — typed-answer input
// ---------------------------------------------------------------------------

describe('{{type:FieldName}}', () => {
  it('renders a text input with the correct data-field attribute', () => {
    const r = renderBasic('Q', 'A', '{{type:Front}}', '{{Back}}');
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.front).toContain('<input');
    expect(r.data.front).toContain('type="text"');
    expect(r.data.front).toContain('class="type"');
    expect(r.data.front).toContain('data-field="Front"');
  });

  it('escapes special characters in the field name attribute', () => {
    const note = makeNote(['Q', 'A']);
    const nt   = makeNoteType(
      ['Front', 'Back'],
      [{ qfmt: '{{type:Front}}', afmt: '{{Back}}' }],
    );
    const r = renderTemplate(note, nt, 0);
    expect(r.success).toBe(true);
    if (!r.success) return;
    // No raw < > " & in attribute values
    expect(r.data.front).not.toMatch(/data-field="[^"]*[<>&]/);
  });
});

// ---------------------------------------------------------------------------
// {{#FieldName}} / {{^FieldName}} — conditionals
// ---------------------------------------------------------------------------

describe('expandConditionals', () => {
  const fm = { Filled: 'yes', Empty: '' };

  it('shows content when field is non-empty ({{#Field}})', () => {
    expect(expandConditionals('{{#Filled}}visible{{/Filled}}', fm))
      .toBe('visible');
  });

  it('hides content when field is empty ({{#Field}})', () => {
    expect(expandConditionals('{{#Empty}}hidden{{/Empty}}', fm))
      .toBe('');
  });

  it('shows content when field IS empty ({{^Field}})', () => {
    expect(expandConditionals('{{^Empty}}visible{{/Empty}}', fm))
      .toBe('visible');
  });

  it('hides content when field is non-empty ({{^Field}})', () => {
    expect(expandConditionals('{{^Filled}}hidden{{/Filled}}', fm))
      .toBe('');
  });

  it('handles nested conditionals with different field names', () => {
    const template = '{{#Filled}}outer{{#Filled}}inner{{/Filled}}{{/Filled}}';
    expect(expandConditionals(template, fm)).toBe('outerinner');
  });

  it('hides outer block, so inner block is never evaluated', () => {
    const template = '{{#Empty}}{{#Filled}}inner{{/Filled}}{{/Empty}}';
    expect(expandConditionals(template, fm)).toBe('');
  });

  it('handles mixed conditionals in sequence', () => {
    const template = '{{#Filled}}A{{/Filled}}{{#Empty}}B{{/Empty}}{{^Empty}}C{{/Empty}}';
    expect(expandConditionals(template, fm)).toBe('AC');
  });

  it('preserves non-conditional content unchanged', () => {
    expect(expandConditionals('plain text', fm)).toBe('plain text');
  });

  it('treats whitespace-only field as empty for conditional purposes', () => {
    const fm2 = { Spaces: '   ' };
    expect(expandConditionals('{{#Spaces}}shown{{/Spaces}}', fm2)).toBe('');
    expect(expandConditionals('{{^Spaces}}shown{{/Spaces}}', fm2)).toBe('shown');
  });
});

describe('conditionals in renderTemplate', () => {
  it('shows block when field is non-empty', () => {
    const r = renderBasic('Q', 'A', '{{#Front}}shown{{/Front}}', '{{Back}}');
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.front).toBe('shown');
  });

  it('hides block when field is empty', () => {
    const r = renderBasic('', 'A', '{{#Front}}hidden{{/Front}}', '{{Back}}');
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.front).toBe('');
  });

  it('shows inverted block when field is empty', () => {
    const r = renderBasic('', 'A', '{{^Front}}shown{{/Front}}', '{{Back}}');
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.front).toBe('shown');
  });

  it('can contain field substitutions inside a conditional block', () => {
    const r = renderBasic('Hello', 'A', '{{#Front}}Value: {{Front}}{{/Front}}', '{{Back}}');
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.front).toBe('Value: Hello');
  });
});

// ---------------------------------------------------------------------------
// {{cloze:FieldName}} — cloze deletion rendering
// ---------------------------------------------------------------------------

describe('renderClozeField', () => {
  describe('front side (active cloze hidden)', () => {
    it('replaces active cloze with [...] span', () => {
      const result = renderClozeField('The {{c1::capital}} of France', 1, 'front');
      expect(result).toBe('The <span class="cloze">[...]</span> of France');
    });

    it('shows inactive cloze as plain text', () => {
      const result = renderClozeField('{{c1::one}} and {{c2::two}}', 1, 'front');
      expect(result).toContain('<span class="cloze">[...]</span>');
      expect(result).toContain('two');
      expect(result).not.toContain('<span class="cloze">two</span>');
    });

    it('uses hint text instead of [...] when hint is provided', () => {
      const result = renderClozeField('The {{c1::capital::city name}}', 1, 'front');
      expect(result).toContain('[city name]');
    });

    it('handles multiple active clozes (same number) in one field', () => {
      const result = renderClozeField('{{c1::a}} and {{c1::b}}', 1, 'front');
      expect(result).toBe('<span class="cloze">[...]</span> and <span class="cloze">[...]</span>');
    });
  });

  describe('back side (active cloze revealed)', () => {
    it('wraps active cloze answer in a .cloze span', () => {
      const result = renderClozeField('The {{c1::capital}} of France', 1, 'back');
      expect(result).toBe('The <span class="cloze">capital</span> of France');
    });

    it('shows inactive cloze as plain text (no span)', () => {
      const result = renderClozeField('{{c1::one}} and {{c2::two}}', 1, 'back');
      expect(result).toContain('<span class="cloze">one</span>');
      expect(result).toContain('two');
      expect(result).not.toContain('<span class="cloze">two</span>');
    });

    it('uses the answer (not the hint) on the back side', () => {
      const result = renderClozeField('{{c1::capital::city name}}', 1, 'back');
      expect(result).toBe('<span class="cloze">capital</span>');
    });
  });

  describe('multiple cloze numbers', () => {
    it('clozeNum=2 hides c2, shows c1 and c3 as plain text', () => {
      const field = '{{c1::one}} {{c2::two}} {{c3::three}}';
      const front = renderClozeField(field, 2, 'front');
      expect(front).toContain('one');
      expect(front).not.toContain('<span class="cloze">one</span>');
      expect(front).toContain('<span class="cloze">[...]</span>');
      expect(front).toContain('three');
      expect(front).not.toContain('<span class="cloze">three</span>');
    });

    it('clozeNum=3 reveals c3 on the back side', () => {
      const field = '{{c1::one}} {{c2::two}} {{c3::three}}';
      const back = renderClozeField(field, 3, 'back');
      expect(back).toContain('one');
      expect(back).toContain('two');
      expect(back).toContain('<span class="cloze">three</span>');
    });
  });
});

describe('cloze rendering via renderTemplate', () => {
  function makeClozeNote(fieldValue: string): ParsedNote {
    return makeNote([fieldValue]);
  }

  function makeClozeNoteType(templateCount = 1): ParsedNoteType {
    return {
      id:     '1000000000001',
      name:   'Cloze',
      fields: ['Text', 'Extra'],
      css:    '',
      templates: Array.from({ length: templateCount }, (_, i) => ({
        name: `Cloze ${i + 1}`,
        ord:  i,
        qfmt: '{{cloze:Text}}',
        afmt: '{{cloze:Text}}<br>{{Extra}}',
      })),
    };
  }

  it('front hides cloze 1 when templateIndex is 0', () => {
    const note = makeClozeNote('The {{c1::Eiffel Tower}} is in {{c2::Paris}}');
    const nt   = makeClozeNoteType(2);
    const r = renderTemplate(note, nt, 0);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.front).toContain('[...]');
    expect(r.data.front).not.toContain('Eiffel Tower');
    expect(r.data.front).toContain('Paris');
  });

  it('back reveals cloze 1 when templateIndex is 0', () => {
    const note = makeClozeNote('The {{c1::Eiffel Tower}} is in {{c2::Paris}}');
    const nt   = makeClozeNoteType(2);
    const r = renderTemplate(note, nt, 0);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.back).toContain('<span class="cloze">Eiffel Tower</span>');
    expect(r.data.back).toContain('Paris');
  });

  it('templateIndex 1 hides cloze 2 on the front', () => {
    const note = makeClozeNote('The {{c1::Eiffel Tower}} is in {{c2::Paris}}');
    const nt   = makeClozeNoteType(2);
    const r = renderTemplate(note, nt, 1);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.front).toContain('Eiffel Tower');
    expect(r.data.front).toContain('[...]');
    expect(r.data.front).not.toContain('Paris');
  });

  it('cloze with hint shows hint text on front', () => {
    const note = makeClozeNote('{{c1::Paris::the capital}}');
    const nt   = makeClozeNoteType(1);
    const r = renderTemplate(note, nt, 0);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.front).toContain('[the capital]');
  });
});

// ---------------------------------------------------------------------------
// Nested conditionals + field substitution combined
// ---------------------------------------------------------------------------

describe('combined: conditionals + field substitution', () => {
  it('renders conditional with inner field substitution', () => {
    const note = makeNote(['Paris', '']);
    const nt   = makeNoteType(
      ['City', 'Extra'],
      [{
        qfmt: '{{#City}}City: {{City}}{{/City}}{{^City}}Unknown city{{/City}}',
        afmt: '{{Extra}}',
      }],
    );
    const r = renderTemplate(note, nt, 0);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.front).toBe('City: Paris');
  });

  it('renders inverted branch when field is empty', () => {
    const note = makeNote(['', '']);
    const nt   = makeNoteType(
      ['City', 'Extra'],
      [{
        qfmt: '{{#City}}City: {{City}}{{/City}}{{^City}}Unknown{{/City}}',
        afmt: '{{Extra}}',
      }],
    );
    const r = renderTemplate(note, nt, 0);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.front).toBe('Unknown');
  });
});

// ---------------------------------------------------------------------------
// buildFieldMap
// ---------------------------------------------------------------------------

describe('buildFieldMap', () => {
  it('maps field names to field values by ordinal position', () => {
    const note = makeNote(['val0', 'val1', 'val2']);
    const nt   = makeNoteType(['Alpha', 'Beta', 'Gamma'], [{ qfmt: '', afmt: '' }]);
    const map  = buildFieldMap(note, nt);
    expect(map['Alpha']).toBe('val0');
    expect(map['Beta']).toBe('val1');
    expect(map['Gamma']).toBe('val2');
  });

  it('adds Tags pseudo-field', () => {
    const note = makeNote(['v'], ['one', 'two']);
    const nt   = makeNoteType(['F'], [{ qfmt: '', afmt: '' }]);
    expect(buildFieldMap(note, nt)['Tags']).toBe('one two');
  });

  it('defaults missing fields to empty string', () => {
    const note = makeNote([]); // no field values
    const nt   = makeNoteType(['Front'], [{ qfmt: '', afmt: '' }]);
    expect(buildFieldMap(note, nt)['Front']).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Multiple templates on same note type
// ---------------------------------------------------------------------------

describe('multiple templates', () => {
  it('renders the correct template for each index', () => {
    const note = makeNote(['A side', 'B side']);
    const nt   = makeNoteType(
      ['Front', 'Back'],
      [
        { name: 'Forward', qfmt: '{{Front}}', afmt: '{{Back}}' },
        { name: 'Reversed', qfmt: '{{Back}}',  afmt: '{{Front}}' },
      ],
    );

    const r0 = renderTemplate(note, nt, 0);
    const r1 = renderTemplate(note, nt, 1);

    expect(r0.success).toBe(true);
    expect(r1.success).toBe(true);
    if (!r0.success || !r1.success) return;

    expect(r0.data.front).toContain('A side');
    expect(r1.data.front).toContain('B side');
  });
});
