import { useEffect, useState } from 'react';

// Colour theme: follow the system, or force light / dark. The choice is a
// per-browser preference kept in localStorage.

export type Theme = 'system' | 'light' | 'dark';

const KEY = 'exfolio.theme';
const ORDER: Theme[] = ['system', 'light', 'dark'];
export const THEME_LABELS: Record<Theme, string> = { system: '跟隨系統', light: '明亮', dark: '黑色' };

export function loadTheme(): Theme {
  try {
    const stored = localStorage.getItem(KEY) as Theme | null;
    return stored && ORDER.includes(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

export function useTheme(): { theme: Theme; cycle: () => void } {
  const [theme, setTheme] = useState<Theme>(loadTheme);
  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      // Storage unavailable: the choice lasts for this page view only.
    }
  }, [theme]);
  return { theme, cycle: () => setTheme((t) => ORDER[(ORDER.indexOf(t) + 1) % ORDER.length]) };
}
