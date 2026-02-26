import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isMainModule } from '../src/dashboard/server.js';

describe('dashboard server main module detection', () => {
  it('matches when argv path points to current module path', () => {
    const serverModuleUrl = new URL('../src/dashboard/server.ts', import.meta.url).href;
    const argvPath = path.resolve('src/dashboard/server.ts');

    expect(isMainModule(serverModuleUrl, argvPath)).toBe(true);
  });

  it('returns false when argv path is missing or points elsewhere', () => {
    const serverModuleUrl = new URL('../src/dashboard/server.ts', import.meta.url).href;

    expect(isMainModule(serverModuleUrl, undefined)).toBe(false);
    expect(isMainModule(serverModuleUrl, path.resolve('src/cli.ts'))).toBe(false);
  });
});
