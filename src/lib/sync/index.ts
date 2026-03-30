/**
 * Sync module — per-deck change-log sync system.
 *
 * Re-exports the public API from all sync submodules.
 */

export type {
  EditFile,
  EditOp,
  ReviewOp,
  CardAddOp,
  CardEditOp,
  CardDeleteOp,
  CardSuspendOp,
  DeckRenameOp,
  DeckSettingsOp,
  TagAddOp,
  TagRenameOp,
  TagDeleteOp,
  DeckTagAddOp,
  DeckTagRemoveOp,
  NoteEditOp,
  DeckSnapshot,
  DeckRegistry,
  DeckRegistryEntry,
  SyncDeckSettings,
} from './types';

export type { SyncStorage, PendingEdit } from './syncStorage';

export {
  createHLC,
  formatHLC,
  parseHLC,
  compareHLC,
  generateDeviceId,
} from './hlc';
export type { HLCClock, HLCComponents } from './hlc';

export { writeEdit, flushPendingEdits } from './editWriter';
export { readAllEdits, readEditsAfter, readSnapshot, listSyncedDeckIds } from './editReader';
export { replayEdits } from './replay';
export { compactDeck } from './compact';

export { needsMigration, migrateMonolithicDb } from './migration';

export {
  initRegistry,
  getRegistry,
  getDeviceId,
  serializeRegistry,
  getAllDeckEntries,
  getDeckEntry,
  upsertDeckEntry,
  removeDeckEntry,
  softDeleteDeck,
  updateDeckMeta,
  reconcileWithICloud,
} from './deckRegistry';
