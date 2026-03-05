import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildDashboardIndex } from '../src/dashboard/data.js';

const created: string[] = [];

afterEach(async () => {
  await Promise.all(created.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('broken links artifact compatibility', () => {
  it('falls back to broken-links.csv when broken-links.json is missing', async () => {
    const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dashboard-broken-links-'));
    created.push(runDir);
    const pageDir = path.join(runDir, 'page-0001-example-com-abcd1234');
    await fs.mkdir(pageDir, { recursive: true });

    await fs.writeFile(
      path.join(pageDir, 'target-summary.json'),
      JSON.stringify({ url: 'https://example.com/', runId: 'run-csv', environment: 'test', overallScore: 85 }),
      'utf8'
    );

    await fs.writeFile(
      path.join(pageDir, 'broken-links.csv'),
      'sourcePageUrl,brokenUrl,statusCode,failureReason\nhttps://example.com/,https://example.com/missing,404,not found\n',
      'utf8'
    );

    const { index, store } = await buildDashboardIndex(runDir);
    const page = index.urls[0];

    expect(page.sections['broken-links.json'].state).toBe('issues');
    expect(page.sections['broken-links.json'].summary.brokenCount).toBe(1);

    const loaded = await store.loadSection(page.id, 'broken-links.json');
    expect(loaded.state).toBe('issues');
    expect((loaded.raw as { details?: unknown[] }).details).toHaveLength(1);
  });
});
