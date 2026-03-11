import type { ReactNode } from 'react';
import { ThemeContext, useThemeState } from '../hooks/useTheme';

interface Props {
  children: ReactNode;
}

/**
 * Provides theme context to the app. Apply once at the root.
 */
export function ThemeProvider({ children }: Props) {
  const value = useThemeState();
  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}
