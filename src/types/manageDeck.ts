import type { Database } from 'sql.js';
import type { UseDeckManagerReturn } from '../hooks/useDeckManager';

export interface ManageDeckActionsProps {
  db: Database | null;
  deckId: string;
  deckName: string;
  manager?: UseDeckManagerReturn | undefined;
  nameDraft: string;
  onNameDraftChange: (name: string) => void;
  onBusyChange?: (busy: boolean) => void;
  onRenamed: (name: string) => void;
  onDeleted: () => void;
  onStats: () => void;
  onSettings: () => void;
}

/** Persist an edit record after its local database mutation. */
export type PersistManagedDeckEdit = (ops: import('../lib/sync/types').EditOp[]) => Promise<string | null>;
