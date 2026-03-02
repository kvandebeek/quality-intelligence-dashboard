import { describe, expect, it } from 'vitest';
import { createBatchOutputFolder, expandBatchRunConfig, loadRunPlan } from '../src/config/loadConfig.js';

describe('loadRunPlan', () => {
  it('detects single-run config shape', () => {
    const plan = loadRunPlan('config/example.config.json');
    expect(plan.kind).toBe('single');
    if (plan.kind === 'single') {
      expect(plan.config.startUrl).toMatch(/^https?:\/\//);
    }
  });

  it('detects batch config shape and expands runs', () => {
    const plan = loadRunPlan('batch-test.json');
    expect(plan.kind).toBe('batch');
    if (plan.kind === 'batch') {
      expect(plan.runs).toHaveLength(3);
      expect(plan.runs[0]?.config.outputDir).toContain('artifacts/RESILLION');
    }
  });

  it('merges defaults with per-item overrides', () => {
    const runs = expandBatchRunConfig({
      defaults: {
        browser: 'webkit',
        headless: true,
        environment: 'staging',
        iteration: 2,
        outputDir: 'tmp-artifacts',
        elasticsearch: { enabled: false, indexPrefix: 'quality-signal' }
      },
      batch: [
        {
          name: 'Site One',
          startUrl: 'https://example.com',
          crawl: {
            enabled: true,
            maxDepth: 1,
            maxPages: 3,
            includeExternalDomains: false,
            allowedDomains: ['example.com']
          }
        }
      ]
    });

    expect(runs[0]?.config.browser).toBe('webkit');
    expect(runs[0]?.config.environment).toBe('staging');
    expect(runs[0]?.config.name).toBe('Site One');
    expect(runs[0]?.config.startUrl).toBe('https://example.com');
    expect(runs[0]?.config.outputDir).toContain('tmp-artifacts/Site One');
  });

  it('sanitizes batch output folder names', () => {
    const folder = createBatchOutputFolder(' My<>Fancy::Target? ', 'https://www.example-domain.com/path?q=1');
    expect(folder).toBe('My_Fancy_Target');
  });

  it('falls back to hostname when sanitized batch name is empty', () => {
    const folder = createBatchOutputFolder('   <>:*?"/\\|   ', 'https://www.Example-Domain.com/path?q=1');
    expect(folder).toBe('unknown-www_example_domain_com');
  });
});
