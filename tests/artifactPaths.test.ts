import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildBatchOutputDir, ensureUniqueRunRoot, resolveBatchItemFolderName, sanitizeBatchItemName } from '../src/utils/artifactPaths.js';

describe('artifact path utilities', () => {
  it('sanitizes batch item names with invalid characters', () => {
    expect(sanitizeBatchItemName('  Team<>:"/\\|?*\u0000Name  ')).toBe('Team_Name');
    expect(sanitizeBatchItemName('___A___B___')).toBe('A_B');
  });

  it('builds batch output dirs under artifacts root using item name', () => {
    const outputDir = buildBatchOutputDir('artifacts', 'AGGEREM', 'https://www.aggerem.be');
    expect(outputDir).toBe(path.join('artifacts', 'AGGEREM'));
    expect(resolveBatchItemFolderName('   ', 'https://www.aggerem.be')).toBe('unknown-www_aggerem_be');
  });

  it('creates deterministic unique run roots to avoid overwrite collisions', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-paths-'));

    const first = ensureUniqueRunRoot(tempRoot, 'AGGEREM-20260302T110047Z-chromium-it1');
    fs.mkdirSync(first, { recursive: true });

    const second = ensureUniqueRunRoot(tempRoot, 'AGGEREM-20260302T110047Z-chromium-it1');
    expect(second).toBe(path.join(tempRoot, 'AGGEREM-20260302T110047Z-chromium-it1-r2'));
    fs.mkdirSync(second, { recursive: true });

    const third = ensureUniqueRunRoot(tempRoot, 'AGGEREM-20260302T110047Z-chromium-it1');
    expect(third).toBe(path.join(tempRoot, 'AGGEREM-20260302T110047Z-chromium-it1-r3'));

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });
});
