import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildDashboardIndex, loadDashboardRun, toOverviewRows } from '../src/dashboard/data.js';

describe('dashboard parsing', () => {
  it('parses fixture run folders and computes overview rows', async () => {
    const fixturePath = path.resolve('tests/fixtures/dashboard-run');
    const run = await loadDashboardRun(fixturePath);
    const rows = toOverviewRows(run);

    expect(rows).toHaveLength(2);
    expect(rows[0]?.url).toBe('https://example.com/');
    expect(rows[0]?.resourceCount).toBeGreaterThanOrEqual(0);
    expect(rows[1]?.critical).toBeGreaterThanOrEqual(0);
  });

  it('extracts run metadata with deterministic runtime formatting fallback', async () => {
    const fixturePath = path.resolve('tests/fixtures/dashboard-run');
    const { index } = await buildDashboardIndex(fixturePath);
    const first = index.urls.find((entry) => entry.id === 'page-0001-example-com-aaaa1111');
    const second = index.urls.find((entry) => entry.id === 'page-0002-example-com-about-bbbb2222');

    expect(first?.runId).toBe('run-fixture-001');
    expect(first?.runTime).toBe('2m 5s');
    expect(second?.runId).toBe('run-fixture-002');
    expect(second?.runTime).toBe('0m 59s');
    expect(second?.environment).toBe('staging');
  });

  it('marks seo-score as missing without crashing when artifact is absent', async () => {
    const fixturePath = path.resolve('tests/fixtures/dashboard-run');
    const { index } = await buildDashboardIndex(fixturePath);
    const second = index.urls.find((entry) => entry.id === 'page-0002-example-com-about-bbbb2222');

    expect(second?.sections['seo-score.json'].state).toBe('missing');
  });
});
