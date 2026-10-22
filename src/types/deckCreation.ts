export type OnboardingAction = 'sample' | 'create' | 'import';

export interface DeckEntryChoicesProps {
  disabled?: boolean;
  importing?: boolean;
  onCreate: () => void;
  onImport: () => void;
}

export interface DeckNameFormProps {
  nameLocked?: boolean;
  creating: boolean;
  disabled?: boolean;
  error: string | null;
  onCreate: (name: string) => void;
  name: string;
  onNameChange: (name: string) => void;
}

export interface DeckCreationScreenProps {
  nameLocked?: boolean;
  ready?: boolean;
  creating: boolean;
  error: string | null;
  initialStep: 'choose' | 'name';
  onCreate: (name: string) => void;
  onImport: () => void;
  onCancel: () => void;
}

export interface ImportConflictDialogProps {
  deckName: string;
  canReplace: boolean;
  onKeepBoth: () => void;
  onReplace: () => void;
  onCancel: () => void;
}
