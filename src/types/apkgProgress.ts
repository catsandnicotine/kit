import type { CardState, ReviewLog } from './index';

/** Legacy exports matched rendered content; retained only for old-file compatibility. */
export interface KitProgressV1 {
  version: 1;
  statesByContent: Record<string, CardState>;
  logsByContent: Record<string, ReviewLog[]>;
}

export interface KitCardProgress {
  state: CardState | null;
  logs: ReviewLog[];
}

/** Package-local Anki card IDs keep identical-looking cards' histories distinct. */
export interface KitProgressV2 {
  version: 2;
  exportedAt: number;
  cardsById: Record<string, KitCardProgress>;
}

export type KitProgressData = KitProgressV1 | KitProgressV2;
