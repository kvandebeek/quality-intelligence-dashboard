import { describe, expect, it, vi } from 'vitest';
import { expandBatchRunConfig } from '../src/config/loadConfig.js';
import { executeBatchRuns } from '../src/core/runBatch.js';
import type { AppConfig, RunSummary } from '../src/models/types.js';

describe('executeBatchRuns', () => {
  it('calls the engine once per expanded batch item with effective configs', async () => {
    const runs = expandBatchRunConfig({
      defaults: {
        browser: 'chromium',
        headless: true,
        environment: 'local',
        iteration: 1,
        outputDir: 'artifacts'
      },
      batch: [
        {
          name: 'One',
          startUrl: 'https://one.example.com',
          crawl: {
            enabled: true,
            maxDepth: 1,
            maxPages: 4,
            includeExternalDomains: false,
            allowedDomains: ['one.example.com']
          }
        },
        {
          name: 'Two',
          startUrl: 'https://two.example.com',
          crawl: {
            enabled: true,
            maxDepth: 2,
            maxPages: 5,
            includeExternalDomains: false,
            allowedDomains: ['two.example.com']
          }
        }
      ]
    });

    const engine = vi.fn(async (config: AppConfig): Promise<RunSummary> => ({
      metadata: {
        runId: `run-${config.name ?? 'unknown'}`,
        timestamp: '20260226T113003Z',
        browser: config.browser,
        environment: config.environment,
        iteration: config.iteration,
        name: config.name,
        startUrl: config.startUrl,
        targets: config.targets
      },
      outputs: []
    }));

    const result = await executeBatchRuns(runs, engine);

    expect(engine).toHaveBeenCalledTimes(2);
    expect(engine.mock.calls[0]?.[0].name).toBe('One');
    expect(engine.mock.calls[1]?.[0].name).toBe('Two');
    expect(result.statuses.map((status) => status.status)).toEqual(['pass', 'pass']);
  });
});
