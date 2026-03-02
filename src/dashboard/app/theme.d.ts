export const THEME_STORAGE_KEY: string;
export function getStoredTheme(): 'dark' | 'light' | null;
export function getInitialTheme(): 'dark' | 'light';
export function applyTheme(theme: string): 'dark' | 'light';
export function setTheme(theme: string): 'dark' | 'light';
export function toggleTheme(currentTheme: string): 'dark' | 'light';
