import { describe, expect, it } from 'vitest';
import { computeRunSummary, type OverviewRow } from '../src/dashboard/data.js';

function row(overrides: Partial<OverviewRow>): OverviewRow {
  return {
    folderName: 'page',
    url: 'https://example.com',
    critical: 0,
    serious: 0,
    moderate: 0,
    minor: 0,
    ttfbMs: 0,
    dclMs: 0,
    loadEventMs: 0,
    totalTransferSize: 0,
    resourceCount: 0,
    requestCount: 0,
    failedRequestCount: 0,
    networkTransferSize: 0,
    slowestRequestMs: 0,
    recommendationCounts: {},
    accessibilityIssues: [],
    networkRequests: [],
    networkRecommendations: [],
    ...overrides
  };
}

describe('run summary aggregation', () => {
  it('aggregates counters and deterministically chooses worst pages', () => {
    const summary = computeRunSummary([
      row({ url: 'https://example.com/a', loadEventMs: 500, critical: 1, totalTransferSize: 100 }),
      row({ url: 'https://example.com/b', loadEventMs: 700, critical: 3, totalTransferSize: 80 }),
      row({ url: 'https://example.com/c', loadEventMs: 700, critical: 3, totalTransferSize: 120 })
    ]);

    expect(summary.totalPages).toBe(3);
    expect(summary.accessibilityTotals.critical).toBe(7);
    expect(summary.worstByLoadEventMs.map((item) => item.url)).toEqual([
      'https://example.com/b',
      'https://example.com/c',
      'https://example.com/a'
    ]);
    expect(summary.worstByTransferSize[0]?.url).toBe('https://example.com/c');
  });
});
