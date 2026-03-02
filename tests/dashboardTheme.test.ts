import { afterEach, describe, expect, it } from 'vitest';

import { applyTheme, getInitialTheme, setTheme, toggleTheme } from '../src/dashboard/app/theme.js';

type FakeWindow = Window & {
  localStorage: {
    getItem: (key: string) => string | null;
    setItem: (key: string, value: string) => void;
  };
  matchMedia: (query: string) => { matches: boolean };
};

function installEnvironment({ stored, prefersDark = false }: { stored?: string | null; prefersDark?: boolean }) {
  let storageValue = stored ?? null;
  const fakeWindow = {
    localStorage: {
      getItem: () => storageValue,
      setItem: (_key: string, value: string) => {
        storageValue = value;
      }
    },
    matchMedia: () => ({ matches: prefersDark })
  } as unknown as FakeWindow;

  const fakeDocument = {
    documentElement: {
      dataset: {}
    }
  } as unknown as Document;

  Object.defineProperty(globalThis, 'window', { value: fakeWindow, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'document', { value: fakeDocument, configurable: true, writable: true });

  return {
    getStorage: () => storageValue,
    getTheme: () => (fakeDocument as any).documentElement.dataset.theme
  };
}

afterEach(() => {
  // @ts-expect-error test cleanup
  delete globalThis.window;
  // @ts-expect-error test cleanup
  delete globalThis.document;
});

describe('dashboard theme utility', () => {
  it('uses stored theme when available', () => {
    installEnvironment({ stored: 'light', prefersDark: true });
    expect(getInitialTheme()).toBe('light');
  });

  it('falls back to OS preference when no stored value exists', () => {
    installEnvironment({ stored: null, prefersDark: true });
    expect(getInitialTheme()).toBe('dark');
  });

  it('persists and applies selected theme', () => {
    const env = installEnvironment({ stored: null, prefersDark: false });
    setTheme('dark');
    expect(env.getStorage()).toBe('dark');
    expect(env.getTheme()).toBe('dark');
  });

  it('toggles theme and applies to root attribute', () => {
    const env = installEnvironment({ stored: 'dark' });
    applyTheme('dark');
    expect(toggleTheme('dark')).toBe('light');
    expect(env.getTheme()).toBe('light');
  });
});
