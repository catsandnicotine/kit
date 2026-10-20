import type { JesusPaintingCatalogue } from '../../types/jesusPaintings';
import type { DeckSnapshot } from '../sync/types';
import { JESUS_PAINTING_DECK_ID } from '../jesusPaintingAssets';
import { createEmptyDeckSnapshot } from './deckFactory';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

function sourceLink(url: string, label: string): string {
  const safeUrl = new URL(url);
  if (safeUrl.protocol !== 'https:') throw new Error('Painting sources must use HTTPS.');
  return `<a href="${escapeHtml(safeUrl.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
}

/** Build one identification card per painting, with museum attribution and origin.
 * @param catalogue - Verified museum records and coverage information.
 * @param now - Unix time in seconds for the new deck.
 * @returns A study-ready snapshot with stable artwork IDs and no review history.
 */
export function createJesusPaintingDeckSnapshot(
  catalogue: JesusPaintingCatalogue,
  now = Math.floor(Date.now() / 1000),
): DeckSnapshot {
  const snapshot = createEmptyDeckSnapshot('Jesus in Paintings', JESUS_PAINTING_DECK_ID, now);
  const noteTypeId = `${JESUS_PAINTING_DECK_ID}:painting`;
  snapshot.noteTypes = [{
    id: noteTypeId, deckId: snapshot.deckId, name: 'Painting identification',
    fields: ['Front', 'Back'], templates: [{ name: 'Painting', ord: 0, qfmt: '{{Front}}', afmt: '{{Back}}' }],
    css: '', createdAt: now,
  }];
  snapshot.deck.description = `${catalogue.paintings.length} paintings with museum-designated CC0 images. ${catalogue.scope} Rights checked ${catalogue.checkedOn}.`;
  const seen = new Set<string>();
  snapshot.cards = catalogue.paintings.map(art => {
    if (!/^(met|aic|cma)-\d+$/.test(art.id) || seen.has(art.id) || art.rights !== 'CC0') {
      throw new Error('The painting catalogue contains an invalid or duplicate record.');
    }
    seen.add(art.id);
    const image = `<img src="jesus-${art.id}.jpg" alt="Painting to identify" style="display:block;max-width:100%;max-height:clamp(100px,calc(66vh - 280px),520px);width:auto;height:auto;object-fit:contain;margin:0 auto">`;
    const line = (label: string, value: string) => `<p style="margin:8px 0"><strong>${label}:</strong> ${escapeHtml(value)}</p>`;
    const details = art.provenance
      ? `<details style="margin-top:16px;text-align:left"><summary>Recorded provenance</summary><p style="white-space:pre-line;font-size:0.85em;line-height:1.6">${escapeHtml(art.provenance)}</p></details>`
      : '<p style="font-size:0.85em;opacity:0.75">Ownership history is not supplied in this catalogue. See the museum record.</p>';
    return {
      id: `${JESUS_PAINTING_DECK_ID}:${art.id}`,
      deckId: JESUS_PAINTING_DECK_ID,
      noteId: `${JESUS_PAINTING_DECK_ID}:note:${art.id}`,
      front: `<div style="text-align:center">${image}<p style="margin-top:18px;font-size:0.9em">What is this painting, and who painted it?</p></div>`,
      back: `<div style="text-align:left;line-height:1.5;padding-bottom:48px"><h2 style="font-size:1.25em;font-weight:600;margin:0 0 12px">${escapeHtml(art.title)}</h2>${line('Artist / attribution', art.artist)}${art.artistContext ? line('Artist context', art.artistContext) : ''}${line('Date', art.date || 'Not specified in museum record')}${line(art.originKind, art.origin || 'Not specified in museum record')}${line('Collection', `${art.museum}, ${art.city}`)}${line('Accession', art.accession)}${line('Medium', art.medium)}${details}<p style="margin-top:16px;font-size:0.85em">${sourceLink(art.sourceUrl, 'Museum record')}<br>${sourceLink(art.rightsUrl, 'Image: CC0')} · Checked ${escapeHtml(catalogue.checkedOn)}</p></div>`,
      tags: ['jesus', 'paintings', art.id.split('-')[0]!],
      createdAt: now,
      updatedAt: now,
    };
  });
  snapshot.notes = snapshot.cards.map(card => ({
    id: card.noteId!, deckId: snapshot.deckId, noteTypeId,
    fields: { Front: card.front, Back: card.back }, tags: [...card.tags], createdAt: now, updatedAt: now,
  }));
  snapshot.tags = [
    { tag: 'jesus', color: '#B83C32' },
    { tag: 'paintings', color: '#3166A0' },
    { tag: 'met', color: '#8E8E93' },
    { tag: 'aic', color: '#8E8E93' },
    { tag: 'cma', color: '#8E8E93' },
  ];
  snapshot.deckTags = ['jesus', 'paintings'];
  return snapshot;
}
