import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadDashboardRun, toOverviewRows } from '../src/dashboard/data.js';

describe('dashboard parsing', () => {
  it('parses fixture run folders and computes overview rows', async () => {
    const fixturePath = path.resolve('tests/fixtures/dashboard-run');
    const run = await loadDashboardRun(fixturePath);
    const rows = toOverviewRows(run);

    expect(rows).toHaveLength(2);
    expect(rows[0]?.url).toBe('https://example.com/');
    expect(rows[0]?.failedRequestCount).toBe(1);
    expect(rows[1]?.recommendationCounts.low).toBe(1);
  });
});
