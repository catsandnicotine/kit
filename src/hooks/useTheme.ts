import { createContext, useContext, useEffect, useState } from 'react';
import type { Theme } from '../types';

export interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Returns the current theme and controls to change it.
 * Must be used inside a ThemeProvider.
 */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}

/**
 * Detects the system color scheme preference.
 * @returns 'dark' | 'light'
 */
function getSystemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Applies the theme class to the html element.
 * @param theme - The theme to apply
 */
function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
}

/**
 * Creates the theme state and handlers for use in ThemeProvider.
 * @returns ThemeContextValue
 */
export function useThemeState(): ThemeContextValue {
  const [theme, setThemeState] = useState<Theme>(getSystemTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Sync with system preference changes when no manual override has diverged
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      setThemeState(e.matches ? 'dark' : 'light');
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const setTheme = (next: Theme) => {
    setThemeState(next);
  };

  const toggleTheme = () => {
    setThemeState(prev => (prev === 'dark' ? 'light' : 'dark'));
  };

  return { theme, setTheme, toggleTheme };
}
