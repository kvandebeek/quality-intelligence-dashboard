export const THEME_STORAGE_KEY = 'theme';
const THEMES = new Set(['dark', 'light']);

export function getStoredTheme() {
  if (typeof window === 'undefined') return null;
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return THEMES.has(stored) ? stored : null;
}

export function getSystemTheme() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function getInitialTheme() {
  return getStoredTheme() ?? getSystemTheme();
}

export function applyTheme(theme) {
  const resolved = THEMES.has(theme) ? theme : 'dark';
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = resolved;
  }
  return resolved;
}

export function setTheme(theme) {
  const resolved = applyTheme(theme);
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(THEME_STORAGE_KEY, resolved);
  }
  return resolved;
}

export function toggleTheme(currentTheme) {
  const next = currentTheme === 'dark' ? 'light' : 'dark';
  return setTheme(next);
}
