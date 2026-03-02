export const THEME_STORAGE_KEY = 'theme';
const THEMES = new Set(['dark', 'light']);
const DEFAULT_THEME = 'light';

export function getStoredTheme() {
  if (typeof window === 'undefined') return null;
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return THEMES.has(stored) ? stored : null;
}

export function getInitialTheme() {
  return getStoredTheme() ?? DEFAULT_THEME;
}

export function applyTheme(theme) {
  const resolved = THEMES.has(theme) ? theme : DEFAULT_THEME;
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
