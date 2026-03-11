/**
 * Demo seed data for development.
 *
 * Creates one deck ("Medical Sciences") with 10 cards mixing:
 *  - 8 basic front/back cards (anatomy, pharmacology, physiology)
 *  - 2 cloze-style cards (rendered as plain HTML, no template pipeline)
 *
 * Images are inline SVG so there are no network dependencies.
 *
 * TEMPORARY — remove once the .apkg import flow is complete.
 */

import type { Database } from 'sql.js';
import { v4 as uuidv4 } from 'uuid';
import { insertCard, insertDeck } from './queries';
import type { Card, Deck } from '../../types';

// ---------------------------------------------------------------------------
// SVG assets (inline, no external deps)
// ---------------------------------------------------------------------------

/** Simple schematic mitochondrion. */
const MITOCHONDRIA_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 120" width="200" height="120" style="display:block;margin:12px auto">
  <ellipse cx="100" cy="60" rx="90" ry="50" fill="none" stroke="currentColor" stroke-width="2.5"/>
  <ellipse cx="100" cy="60" rx="72" ry="36" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="4 3"/>
  <!-- cristae -->
  <path d="M 55 30 Q 65 60 55 90" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <path d="M 80 24 Q 90 60 80 96" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <path d="M 120 24 Q 110 60 120 96" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <path d="M 145 30 Q 135 60 145 90" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="100" y="115" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.6">Mitochondrion</text>
</svg>`;

/** Minimal PQRST ECG waveform. */
const ECG_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 260 100" width="260" height="100" style="display:block;margin:12px auto">
  <!-- baseline -->
  <line x1="0" y1="65" x2="260" y2="65" stroke="currentColor" stroke-width="1" opacity="0.2"/>
  <!-- waveform: flat → P → flat → QRS → T → flat -->
  <polyline points="
    10,65
    40,65  45,55  50,65
    70,65
    100,65 105,70 115,10 120,70 125,65
    155,65 175,45 190,65
    240,65
  " fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
  <!-- labels -->
  <text x="45"  y="50" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.6">P</text>
  <text x="114" y="7"  text-anchor="middle" font-size="9" fill="currentColor" opacity="0.6">R</text>
  <text x="104" y="78" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.6">Q</text>
  <text x="124" y="78" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.6">S</text>
  <text x="173" y="42" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.6">T</text>
</svg>`;

/** DNA double helix schematic. */
const DNA_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 160" width="80" height="107" style="display:block;margin:12px auto">
  <!-- left backbone -->
  <path d="M 30 10 C 30 40 90 50 90 80 C 90 110 30 120 30 150" fill="none" stroke="currentColor" stroke-width="2.5"/>
  <!-- right backbone -->
  <path d="M 90 10 C 90 40 30 50 30 80 C 30 110 90 120 90 150" fill="none" stroke="currentColor" stroke-width="2.5"/>
  <!-- rungs -->
  <line x1="40" y1="28" x2="80" y2="28" stroke="currentColor" stroke-width="1.5" opacity="0.7"/>
  <line x1="55" y1="48" x2="65" y2="48" stroke="currentColor" stroke-width="1.5" opacity="0.7"/>
  <line x1="65" y1="68" x2="55" y2="68" stroke="currentColor" stroke-width="1.5" opacity="0.7"/>
  <line x1="52" y1="88" x2="68" y2="88" stroke="currentColor" stroke-width="1.5" opacity="0.7"/>
  <line x1="60" y1="108" x2="60" y2="108" stroke="currentColor" stroke-width="1.5" opacity="0.7"/>
  <line x1="40" y1="125" x2="80" y2="125" stroke="currentColor" stroke-width="1.5" opacity="0.7"/>
</svg>`;

// ---------------------------------------------------------------------------
// Card content
// ---------------------------------------------------------------------------

interface RawCard {
  front: string;
  back: string;
  tags: string[];
}

const CARDS: RawCard[] = [
  // ── 1 ── Mitochondria ────────────────────────────────────────────────────
  {
    front: `
      <p style="font-weight:600;margin-bottom:8px">What is the primary function of the mitochondria?</p>
      ${MITOCHONDRIA_SVG}
    `,
    back: `
      ${MITOCHONDRIA_SVG}
      <p style="font-weight:600;margin-bottom:6px">ATP production via oxidative phosphorylation</p>
      <p style="font-size:0.9em;line-height:1.6">
        The inner mitochondrial membrane houses the <strong>electron transport chain</strong>
        (Complexes I–IV) and <strong>ATP synthase</strong>.
        For each glucose: ~30–32 ATP produced (aerobic), vs. only 2 ATP (anaerobic glycolysis).
      </p>
    `,
    tags: ['cell-biology', 'biochemistry'],
  },

  // ── 2 ── Action potential ─────────────────────────────────────────────────
  {
    front: `
      <p style="font-weight:600">At what membrane potential does a neuron's action potential fire?</p>
    `,
    back: `
      <p style="font-weight:600;margin-bottom:6px">Threshold ≈ −55 mV</p>
      <p style="font-size:0.9em;line-height:1.6">
        When V<sub>m</sub> reaches ~−55 mV, voltage-gated <strong>Na⁺ channels</strong> open
        causing rapid depolarization to ~+30 mV.
        Repolarization follows via delayed K⁺ channel opening.
        Resting potential is approximately −70 mV.
      </p>
    `,
    tags: ['neurophysiology', 'physiology'],
  },

  // ── 3 ── Frank-Starling ───────────────────────────────────────────────────
  {
    front: `
      <p style="font-weight:600">State Frank-Starling's law of the heart.</p>
    `,
    back: `
      <p style="font-weight:600;margin-bottom:6px">↑ preload → ↑ stroke volume</p>
      <p style="font-size:0.9em;line-height:1.6">
        The heart's stroke volume increases in response to increased
        <strong>end-diastolic volume (EDV / preload)</strong>.
        Greater fibre stretch → greater overlap of actin/myosin crossbridges →
        greater force of contraction.
        Physiological basis of the cardiac length–tension relationship.
      </p>
    `,
    tags: ['cardiology', 'physiology'],
  },

  // ── 4 ── ACE / RAAS ───────────────────────────────────────────────────────
  {
    front: `
      <p style="font-weight:600">Which enzyme converts Angiotensin I → Angiotensin II?</p>
      <p style="font-size:0.85em;margin-top:6px;opacity:0.6">Hint: found primarily in the pulmonary endothelium</p>
    `,
    back: `
      <p style="font-weight:600;margin-bottom:6px">Angiotensin-Converting Enzyme (ACE)</p>
      <p style="font-size:0.9em;line-height:1.6">
        ACE (a zinc-dependent dipeptidyl carboxypeptidase) cleaves two amino acids from
        Angiotensin I to produce <strong>Angiotensin II</strong>, a potent vasoconstrictor.
        Ang II also stimulates aldosterone release → Na⁺/water retention.
        <em>ACE inhibitors</em> (e.g. lisinopril, ramipril) block this step.
      </p>
    `,
    tags: ['pharmacology', 'nephrology', 'cardiology'],
  },

  // ── 5 ── Metformin ────────────────────────────────────────────────────────
  {
    front: `
      <p style="font-weight:600">First-line pharmacotherapy for Type 2 diabetes mellitus?</p>
    `,
    back: `
      <p style="font-weight:600;margin-bottom:6px">Metformin (biguanide)</p>
      <p style="font-size:0.9em;line-height:1.6">
        <strong>Mechanism:</strong> activates AMPK → ↓ hepatic gluconeogenesis +
        ↑ peripheral insulin sensitivity.<br>
        <strong>Advantages:</strong> no hypoglycaemia, weight-neutral, cardioprotective (UKPDS).<br>
        <strong>Contraindications:</strong> eGFR &lt; 30 (lactic acidosis risk), IV contrast.
      </p>
    `,
    tags: ['pharmacology', 'endocrinology'],
  },

  // ── 6 ── ECG P wave ───────────────────────────────────────────────────────
  {
    front: `
      <p style="font-weight:600;margin-bottom:4px">What does the P wave on an ECG represent?</p>
      ${ECG_SVG}
    `,
    back: `
      ${ECG_SVG}
      <p style="font-weight:600;margin-bottom:6px">Atrial depolarisation</p>
      <p style="font-size:0.9em;line-height:1.6">
        Generated by the <strong>sinoatrial (SA) node</strong> spreading through both atria.
        Normal: duration &lt;120 ms, amplitude &lt;2.5 mm in lead II.
        Abnormal P waves suggest atrial enlargement, ectopic pacemaker, or atrial flutter.
      </p>
    `,
    tags: ['cardiology', 'ECG'],
  },

  // ── 7 ── Serum sodium ─────────────────────────────────────────────────────
  {
    front: `
      <p style="font-weight:600">Normal serum sodium concentration?</p>
    `,
    back: `
      <p style="font-weight:600;margin-bottom:6px">135–145 mEq/L (mmol/L)</p>
      <p style="font-size:0.9em;line-height:1.6">
        Na⁺ is the dominant <strong>extracellular cation</strong> and the primary
        determinant of plasma osmolality (Posm ≈ 2[Na⁺] + glucose/18 + BUN/2.8).<br>
        <strong>Hyponatraemia:</strong> &lt;135 (SIADH, heart failure, cirrhosis).<br>
        <strong>Hypernatraemia:</strong> &gt;145 (dehydration, diabetes insipidus).
      </p>
    `,
    tags: ['biochemistry', 'nephrology'],
  },

  // ── 8 ── Metabolic acidosis compensation ─────────────────────────────────
  {
    front: `
      <p style="font-weight:600">In metabolic acidosis, what is the expected respiratory compensation?</p>
    `,
    back: `
      <p style="font-weight:600;margin-bottom:6px">Hyperventilation → ↓ PaCO₂</p>
      <p style="font-size:0.9em;line-height:1.6">
        Central chemoreceptors sense ↓ pH → stimulate the respiratory centre →
        <strong>Kussmaul breathing</strong> (deep, laboured).<br>
        <strong>Winter's formula:</strong>
        expected PaCO₂ = 1.5 × [HCO₃⁻] + 8 ± 2 mmHg.<br>
        PaCO₂ lower than predicted → superimposed respiratory alkalosis.
      </p>
    `,
    tags: ['physiology', 'acid-base'],
  },

  // ── 9 ── Cloze: SA node ───────────────────────────────────────────────────
  {
    front: `
      <p style="font-size:0.8em;text-transform:uppercase;letter-spacing:0.05em;opacity:0.5;margin-bottom:8px">Fill in the blank</p>
      <p style="line-height:1.8">
        The
        <span style="display:inline-block;min-width:120px;border-bottom:2px solid currentColor;text-align:center">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>
        is the primary pacemaker of the heart, generating impulses at
        <span style="display:inline-block;min-width:80px;border-bottom:2px solid currentColor;text-align:center">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>
        beats per minute.
      </p>
    `,
    back: `
      <p style="line-height:1.8">
        The <strong style="text-decoration:underline">sinoatrial (SA) node</strong>
        is the primary pacemaker of the heart, generating impulses at
        <strong style="text-decoration:underline">60–100</strong>
        beats per minute.
      </p>
      <p style="font-size:0.85em;line-height:1.6;margin-top:10px;opacity:0.75">
        Located in the right atrium near the superior vena cava. Innervated by sympathetic
        (↑ rate) and parasympathetic/vagus (↓ rate) fibres. Intrinsic rate: 60–100 bpm
        (AV node backup: 40–60 bpm; ventricular: 20–40 bpm).
      </p>
    `,
    tags: ['cardiology', 'cloze'],
  },

  // ── 10 ── Cloze: DNA replication ─────────────────────────────────────────
  {
    front: `
      <p style="font-size:0.8em;text-transform:uppercase;letter-spacing:0.05em;opacity:0.5;margin-bottom:8px">Fill in the blank</p>
      ${DNA_SVG}
      <p style="line-height:1.8">
        DNA replication is
        <span style="display:inline-block;min-width:110px;border-bottom:2px solid currentColor;text-align:center">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>
        — each new double helix contains one
        <span style="display:inline-block;min-width:90px;border-bottom:2px solid currentColor;text-align:center">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>
        strand and one newly synthesised strand.
      </p>
    `,
    back: `
      ${DNA_SVG}
      <p style="line-height:1.8">
        DNA replication is <strong style="text-decoration:underline">semi-conservative</strong>
        — each new double helix contains one
        <strong style="text-decoration:underline">parental (template)</strong>
        strand and one newly synthesised strand.
      </p>
      <p style="font-size:0.85em;line-height:1.6;margin-top:10px;opacity:0.75">
        Demonstrated by Meselson &amp; Stahl (1958) using ¹⁵N/¹⁴N density-gradient centrifugation.
        Key enzymes: helicase (unwinds), primase (RNA primer), DNA pol III (elongation 5′→3′),
        DNA pol I (removes primer), ligase (seals nicks).
      </p>
    `,
    tags: ['molecular-biology', 'cloze'],
  },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const DEMO_DECK_ID = 'demo-deck-00000000-0000-0000-0000-000000000000';

/**
 * Insert the demo deck and its 10 cards into the database.
 * Safe to call multiple times — skips insertion if the deck already exists.
 *
 * @param db - Initialised sql.js Database with Kit schema applied.
 * @returns The deck ID on success, or an error.
 */
export function seedDemoData(db: Database): { success: true; deckId: string } | { success: false; error: string } {
  try {
    // Idempotent: skip if already seeded.
    const existing = db.exec('SELECT id FROM decks WHERE id = ?', [DEMO_DECK_ID]);
    if (existing[0]?.values?.length) {
      return { success: true, deckId: DEMO_DECK_ID };
    }

    const now = Math.floor(Date.now() / 1000);

    const deck: Deck = {
      id: DEMO_DECK_ID,
      name: 'Medical Sciences',
      description: 'Demo deck — physiology, pharmacology & molecular biology.',
      createdAt: now,
      updatedAt: now,
    };

    const deckResult = insertDeck(db, deck);
    if (!deckResult.success) return deckResult;

    for (const raw of CARDS) {
      const card: Card = {
        id: uuidv4(),
        deckId: DEMO_DECK_ID,
        noteId: null,
        front: raw.front.trim(),
        back: raw.back.trim(),
        tags: raw.tags,
        createdAt: now,
        updatedAt: now,
      };
      const cardResult = insertCard(db, card);
      if (!cardResult.success) return cardResult;
    }

    // ── DEBUG ──────────────────────────────────────────────────────────────
    const countResult = db.exec('SELECT COUNT(*) as n FROM cards WHERE deck_id = ?', [DEMO_DECK_ID]);
    const cardCount = countResult[0]?.values?.[0]?.[0] ?? 'unknown';
    console.debug('[seed] cards in db after seed:', cardCount);
    // ───────────────────────────────────────────────────────────────────────

    return { success: true, deckId: DEMO_DECK_ID };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}
