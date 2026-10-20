import type { ReactNode } from 'react';

/** A rendered deck-menu action or submenu entry. */
export interface DeckMenuItem {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  next?: boolean;
}
