import { useEffect, useState } from 'react';
import { CardEditor } from '../src/components/CardEditor';
import { initializeCardSeen } from '../src/lib/cardSeen';
import type { Card } from '../src/types';
import type { CardSeenFileStorage } from '../src/types/cardSeen';
import '../src/index.css';

const card: Card = { id:'count-sample', deckId:'count-preview', noteId:null,
  front:'<p>Which light crosses the room?</p>', back:'<p>The afternoon light.</p>',
  tags:[], createdAt:1, updatedAt:1 };
const files = new Map<string, string>([['count-preview/preview-device.json', JSON.stringify({
  v:1, kind:'total', deckId:card.deckId, deviceId:'preview-device', counts:{ [card.id]:3 },
})]]);
const storage: CardSeenFileStorage = {
  async readFile(path) { return files.get(path) ?? null; },
  async writeFile(path, data) { files.set(path, data); },
  async deleteFile(path) { files.delete(path); },
  async listDirectory(path) {
    const prefix = `${path}/`;
    return [...new Set([...files.keys()].filter(key => key.startsWith(prefix)).map(key => key.slice(prefix.length).split('/')[0]!))];
  },
};

/** Exercise the real editor with disposable in-memory counts and no card database.
 * @returns An isolated reset preview; reloading restores the sample count to three.
 */
export function CardEditorCountPreview() {
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void initializeCardSeen({ deviceId:'preview-device', local:storage }).then(() => {
      if (active) setReady(true);
    }).catch(() => { if (active) setError('Sample could not open.'); });
    return () => { active = false; };
  }, []);
  return <main style={{ padding:24, color:'var(--kit-text)', background:'var(--kit-bg)', minHeight:'100dvh' }}>
    <p>Disposable count preview. Cards, review history and app files are untouched.</p>
    {error && <p role="alert">{error}</p>}
    {ready && !open && <button type="button" onClick={() => setOpen(true)}>Reopen sample editor</button>}
    {ready && open && <CardEditor db={null} card={card} onSave={() => undefined} onDelete={() => undefined} onDismiss={() => setOpen(false)} />}
  </main>;
}
