import { describe, expect, it } from 'vitest';
import { buildDomainSummary } from '../src/dashboard/domainSummary.js';

function section(state: 'ok' | 'issues' | 'missing' | 'not_available', raw: unknown) {
  return { state, raw, summary: {} };
}

describe('domain summary aggregation', () => {
  it('aggregates metrics with coverage and missing/null tolerance', async () => {
    const index = {
      generatedAt: 'run-1',
      urls: [{ id: 'u1' }, { id: 'u2' }, { id: 'u3' }]
    } as any;

    const data: Record<string, Record<string, any>> = {
      u1: {
        'accessibility.json': section('ok', { counters: { critical: 1, serious: 2, moderate: 3, minor: 4 } }),
        'performance.json': section('ok', { paint: { fcpMs: 1600 } }),
        'broken-links.json': section('ok', { brokenCount: 2, checkedCount: 20 }),
        'seo-score.json': section('ok', { overallScore: 90 }),
        'core-web-vitals.json': section('ok', { lcpMs: 2400, cls: 0.08, inpMs: 190 }),
        'stability.json': section('ok', { totalErrors: 3 }),
        'security-scan.json': section('ok', { findings: [{ severity: 'high' }, { severity: 'low' }] }),
        'visual-regression.json': section('ok', { baselineFound: true, diffRatio: 0.03, threshold: 0.01 })
      },
      u2: {
        'accessibility.json': section('issues', { counters: { critical: 0, serious: 1, moderate: 0, minor: 2 } }),
        'performance.json': section('ok', { paint: { fcpMs: 3200 } }),
        'broken-links.json': section('ok', { brokenCount: 0, checkedCount: 10 }),
        'seo-score.json': section('ok', { overallScore: 70 }),
        'core-web-vitals.json': section('ok', { lcpMs: 5000, cls: 0.05, inpMs: 100 }),
        'stability.json': section('ok', { totalErrors: 0 }),
        'security-scan.json': section('ok', { findings: [{ severity: 'medium' }] }),
        'visual-regression.json': section('ok', { baselineFound: false, diffRatio: 0.0, threshold: 0.01 })
      },
      u3: {
        'accessibility.json': section('missing', null),
        'performance.json': section('ok', { paint: { fcpMs: null } }),
        'broken-links.json': section('missing', null),
        'seo-score.json': section('missing', null),
        'core-web-vitals.json': section('ok', { lcpMs: null, cls: null, inpMs: null }),
        'stability.json': section('missing', null),
        'security-scan.json': section('ok', { missingHeaders: ['x-frame-options'] }),
        'visual-regression.json': section('not_available', { baselineFound: true })
      }
    };

    const store = {
      async loadSection(urlId: string, name: string) {
        return data[urlId]?.[name] ?? section('missing', null);
      }
    } as any;

    const summary = await buildDomainSummary(index, store, 'run-1');

    expect(summary.accessibility.totalIssues).toBe(13);
    expect(summary.accessibility.coverage).toEqual({ measured: 2, total: 3 });

    expect(summary.fcp.avgSeconds).toBeCloseTo(2.4, 5);
    expect(summary.fcp.minSeconds).toBeCloseTo(1.6, 5);
    expect(summary.fcp.maxSeconds).toBeCloseTo(3.2, 5);

    expect(summary.brokenLinks.broken).toBe(2);
    expect(summary.brokenLinks.total).toBe(30);
    expect(summary.seoScore.avg).toBe(80);

    expect(summary.coreWebVitals.good).toBe(1);
    expect(summary.coreWebVitals.poor).toBe(1);
    expect(summary.coreWebVitals.coverage).toEqual({ measured: 2, total: 3 });

    expect(summary.clientErrors.totalErrors).toBe(3);
    expect(summary.clientErrors.affectedUrls).toBe(1);

    expect(summary.security.totalFindings).toBe(4);
    expect(summary.security.severities.high).toBe(1);
    expect(summary.security.severities.medium).toBe(1);
    expect(summary.security.severities.low).toBe(1);
    expect(summary.security.severities.info).toBe(1);

    expect(summary.visualRegression.changedUrls).toBe(1);
    expect(summary.visualRegression.baselineFound).toBe(2);
  });
});
