import { useSyncExternalStore } from 'react';

// Light / dark theme. A first visit follows the system setting, and keeps
// following it until the visitor picks one; that choice is then kept in
// localStorage. main.tsx imports this module before rendering anything, so
// the page never flashes the wrong colours (the CSP allows no inline script).

export type Theme = 'light' | 'dark';

const KEY = 'exfolio.theme';
const listeners = new Set<() => void>();
const systemQuery =
  typeof window !== 'undefined' ? window.matchMedia?.('(prefers-color-scheme: dark)') : undefined;

function saved(): Theme | null {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

let current: Theme = saved() ?? (systemQuery?.matches ? 'dark' : 'light');

function apply() {
  if (typeof document !== 'undefined') document.documentElement.dataset.theme = current;
  listeners.forEach((l) => l());
}
apply();

systemQuery?.addEventListener?.('change', (e) => {
  if (saved()) return;
  current = e.matches ? 'dark' : 'light';
  apply();
});

export function toggleTheme() {
  current = current === 'dark' ? 'light' : 'dark';
  try {
    localStorage.setItem(KEY, current);
  } catch {
    // Storage unavailable: the switch holds for this page view only.
  }
  apply();
}

/** The theme in use: 'light' or 'dark'. */
export function useTheme(): Theme {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}
