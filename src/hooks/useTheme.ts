import { createContext, useContext, useEffect, useState } from 'react';
import type { Theme } from '../types';

/** The resolved (applied) theme: always 'light' or 'dark'. */
type ResolvedTheme = 'light' | 'dark';

export interface ThemeContextValue {
  /** The user's theme preference (may be 'system'). */
  theme: Theme;
  /** The actually applied theme ('light' or 'dark'). */
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
 * Detects the system color scheme preference.
 * @returns 'dark' | 'light'
 */
function getSystemTheme(): ResolvedTheme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Resolve the effective theme from the preference.
 * @param pref - The theme preference.
 * @returns The resolved theme.
 */
function resolve(pref: Theme): ResolvedTheme {
  return pref === 'system' ? getSystemTheme() : pref;
}

/**
 * Applies the theme class to the html element.
 * @param resolved - The resolved theme to apply.
 */
function applyTheme(resolved: ResolvedTheme): void {
  const root = document.documentElement;
  if (resolved === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
}

/**
 * Load persisted theme preference from localStorage.
 * @returns The saved Theme or 'system' as default.
 */
function loadThemePref(): Theme {
  try {
    const saved = localStorage.getItem(LS_THEME_KEY);
    if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
  } catch { /* ignore */ }
  return 'system';
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
    applyTheme(r);
  }, [theme]);

  // Sync with system preference changes when in 'system' mode
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      if (theme === 'system') {
        const r: ResolvedTheme = e.matches ? 'dark' : 'light';
        setResolved(r);
        applyTheme(r);
      }
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  const setTheme = (next: Theme) => {
    setThemeState(next);
    try { localStorage.setItem(LS_THEME_KEY, next); } catch { /* ignore */ }
  };

  const toggleTheme = () => {
    setThemeState(prev => {
      const next = resolve(prev) === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(LS_THEME_KEY, next); } catch { /* ignore */ }
      return next;
    });
  };

  return { theme, resolvedTheme, setTheme, toggleTheme };
}
