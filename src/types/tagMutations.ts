import type { Database } from 'sql.js';
import type { EditOp, GlobalTag } from '../lib/sync/types';

export type TagMutationOp = Extract<EditOp, { type:'tag_add' | 'tag_rename' | 'tag_delete' }>;

/** Ports for a local-first, scheduling-free global tag operation. */
export interface GlobalTagMutationPorts {
  deckIds: () => string[];
  openDeck: (deckId: string) => Promise<Database | null>;
  writeEdit: (deckId: string, ops: EditOp[]) => Promise<string | null>;
  getCatalog: () => GlobalTag[];
  saveCatalog: (tags: GlobalTag[]) => Promise<void>;
}
