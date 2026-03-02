import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadCrossBrowserConfig } from '../src/config/loadCrossBrowserConfig.js';

const previousCwd = process.cwd();

afterEach(() => {
  process.chdir(previousCwd);
});

describe('loadCrossBrowserConfig', () => {
  it('returns missing source and disabled config when file is absent', () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-config-missing-'));
    process.chdir(temp);
    const loaded = loadCrossBrowserConfig();
    expect(loaded.source).toBe('missing');
    expect(loaded.config.enabled).toBe(false);
  });

  it('returns invalid source on invalid json', () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-config-invalid-'));
    fs.mkdirSync(path.join(temp, 'config'));
    fs.writeFileSync(path.join(temp, 'config', 'features.json'), '{ invalid');
    process.chdir(temp);
    const loaded = loadCrossBrowserConfig();
    expect(loaded.source).toBe('invalid');
    expect(loaded.config.enabled).toBe(false);
  });

  it('loads valid config and clamps invalid runs', () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-config-valid-'));
    fs.mkdirSync(path.join(temp, 'config'));
    fs.writeFileSync(path.join(temp, 'config', 'features.json'), JSON.stringify({
      enabled: true,
      browsers: ['chromium'],
      runs: 99,
      cooldownMs: 10,
      skipIfHeadless: true
    }));
    process.chdir(temp);
    const loaded = loadCrossBrowserConfig();
    expect(loaded.source).toBe('file');
    expect(loaded.config.enabled).toBe(true);
    expect(loaded.config.browsers).toEqual(['chromium']);
    expect(loaded.config.runs).toBe(5);
    expect(loaded.config.cooldownMs).toBe(10);
    expect(loaded.config.skipIfHeadless).toBe(true);
  });
});
