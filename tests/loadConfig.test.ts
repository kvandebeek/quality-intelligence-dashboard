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
      expect(plan.runs[0]?.config.outputDir).toContain('artifacts/batch/001_RESILLION_www_resillion_com');
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
    expect(runs[0]?.config.outputDir).toContain('tmp-artifacts/batch/001_Site_One_example_com');
  });

  it('sanitizes batch output folder names', () => {
    const folder = createBatchOutputFolder(12, 'My Fancy Target!', 'https://www.example-domain.com/path?q=1');
    expect(folder).toBe('012_My_Fancy_Target_www_example_domain_com');
  });
});
