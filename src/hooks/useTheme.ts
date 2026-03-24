import { createContext, useContext, useEffect, useState } from 'react';
import type { Theme } from '../types';

/** The resolved (applied) theme: always 'light' or 'dark'. */
type ResolvedTheme = 'light' | 'dark';

export interface ThemeContextValue {
  /** The user's theme preference ('light', 'dark', or 'black'). */
  theme: Theme;
  /** The actually applied theme ('light' or 'dark'). Both 'dark' and 'black' resolve to 'dark'. */
  resolvedTheme: ResolvedTheme;
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

const LS_THEME_KEY = 'kit_theme';

/**
 * Resolve the effective theme from the preference.
 * Both 'dark' and 'black' resolve to 'dark' for Tailwind's dark: variants.
 * @param pref - The theme preference.
 * @returns The resolved theme.
 */
function resolve(pref: Theme): ResolvedTheme {
  return pref === 'light' ? 'light' : 'dark';
}

/**
 * Applies the theme class and data attribute to the html element.
 * @param theme - The theme preference to apply.
 */
function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'light') {
    root.classList.remove('dark');
  } else {
    root.classList.add('dark');
  }
  root.setAttribute('data-theme', theme);
}

/**
 * Load persisted theme preference from localStorage.
 * @returns The saved Theme or 'black' as default (preserving current OLED dark default).
 */
function loadThemePref(): Theme {
  try {
    const saved = localStorage.getItem(LS_THEME_KEY);
    if (saved === 'light' || saved === 'dark' || saved === 'black') return saved;
    // Migrate old 'system' preference to 'black'
    if (saved === 'system') return 'black';
  } catch { /* ignore */ }
  return 'black';
}

/**
 * Creates the theme state and handlers for use in ThemeProvider.
 * @returns ThemeContextValue
 */
export function useThemeState(): ThemeContextValue {
  const [theme, setThemeState] = useState<Theme>(loadThemePref);
  const [resolvedTheme, setResolved] = useState<ResolvedTheme>(() => resolve(theme));

  useEffect(() => {
    const r = resolve(theme);
    setResolved(r);
    applyTheme(theme);
  }, [theme]);

  const setTheme = (next: Theme) => {
    setThemeState(next);
    try { localStorage.setItem(LS_THEME_KEY, next); } catch { /* ignore */ }
  };

  const toggleTheme = () => {
    setThemeState(prev => {
      const next: Theme = prev === 'light' ? 'dark' : prev === 'dark' ? 'black' : 'light';
      try { localStorage.setItem(LS_THEME_KEY, next); } catch { /* ignore */ }
      return next;
    });
  };

  return { theme, resolvedTheme, setTheme, toggleTheme };
}
