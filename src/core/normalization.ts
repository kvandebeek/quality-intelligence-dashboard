import fs from 'node:fs';
import path from 'node:path';
import type { RunIndex, UnifiedUrlModel } from '../models/platform.js';

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index] ?? 0;
}

function computeDerived(model: Omit<UnifiedUrlModel, 'derived' | 'enterpriseScore'>): UnifiedUrlModel['derived'] {
  const ttfb = model.performance.ttfbMs ?? 0;
  const load = model.performance.loadEventMs ?? 0;
  const issuePenalty = (model.accessibility.counters.critical ?? 0) * 20 + (model.accessibility.counters.serious ?? 0) * 10 + (model.accessibility.counters.moderate ?? 0) * 3 + (model.accessibility.counters.minor ?? 0);
  const performanceCompositeScore = Math.max(0, Math.min(100, 100 - ttfb / 20 - load / 40));
  const accessibilityWeightedScore = Math.max(0, Math.min(100, 100 - issuePenalty));
  const backendPercent = load > 0 ? Math.max(0, Math.min(100, (ttfb / load) * 100)) : 0;
  const frontendPercent = 100 - backendPercent;
  const blockingTimeRatio = load > 0 ? Math.max(0, Math.min(1, (Number(model.performance['totalBlockingTime'] ?? 0)) / load)) : 0;
  return {
    performanceCompositeScore,
    accessibilityWeightedScore,
    backendFrontendRatio: { backendPercent, frontendPercent },
    blockingTimeRatio
  };
}

function computeEnterpriseScores(derived: UnifiedUrlModel['derived'], model: Omit<UnifiedUrlModel, 'derived' | 'enterpriseScore'>): Record<string, number> {
  const securityPasses = Object.values(model.security).filter((value) => value === true).length;
  const securityTotal = Math.max(1, Object.keys(model.security).length);
  const seoPasses = Object.values(model.seo).filter((value) => value === true).length;
  const seoTotal = Math.max(1, Object.keys(model.seo).length);

  return {
    performance: Math.round(derived.performanceCompositeScore),
    accessibility: Math.round(derived.accessibilityWeightedScore),
    security: Math.round((securityPasses / securityTotal) * 100),
    seo: Math.round((seoPasses / seoTotal) * 100),
    visualStability: model.visualRegression.passed ? 100 : Math.max(0, 100 - Math.round((model.visualRegression.diffRatio ?? 1) * 100)),
    stability: model.stability.unstable ? 40 : 90
  };
}

export function buildRunIndex(runRoot: string, runId: string, timestamp: string, toolVersion: string, schemaVersion: string): RunIndex {
  const urls: UnifiedUrlModel[] = [];
  const directories = fs.readdirSync(runRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();

  for (const urlSlug of directories) {
    const urlRoot = path.join(runRoot, urlSlug);
    const perf = readJson(path.join(urlRoot, 'performance.json')) as { meta: UnifiedUrlModel['meta']; payload: { navigation: Record<string, number> } };
    const a11y = readJson(path.join(urlRoot, 'accessibility.json')) as { payload: UnifiedUrlModel['accessibility'] };
    const coreWebVitals = readJson(path.join(urlRoot, 'core-web-vitals.json')) as { payload: UnifiedUrlModel['coreWebVitals'] };
    const lighthouse = readJson(path.join(urlRoot, 'lighthouse-summary.json')) as { payload: UnifiedUrlModel['lighthouse'] };
    const throttled = readJson(path.join(urlRoot, 'throttled-run.json')) as { payload: UnifiedUrlModel['throttled'] };
    const security = readJson(path.join(urlRoot, 'security-scan.json')) as { payload: UnifiedUrlModel['security'] };
    const seo = readJson(path.join(urlRoot, 'seo-checks.json')) as { payload: UnifiedUrlModel['seo'] };
    const visualRegression = readJson(path.join(urlRoot, 'visual-regression.json')) as { payload: UnifiedUrlModel['visualRegression'] };
    const brokenLinks = readJson(path.join(urlRoot, 'broken-links.json')) as { payload: UnifiedUrlModel['brokenLinks'] };
    const thirdPartyRisk = readJson(path.join(urlRoot, 'third-party-risk.json')) as { payload: UnifiedUrlModel['thirdPartyRisk'] };
    const accessibilityBeyondAxe = readJson(path.join(urlRoot, 'a11y-beyond-axe.json')) as { payload: UnifiedUrlModel['accessibilityBeyondAxe'] };
    const stability = readJson(path.join(urlRoot, 'stability.json')) as { payload: UnifiedUrlModel['stability'] };
    const memory = readJson(path.join(urlRoot, 'memory-profile.json')) as { payload: UnifiedUrlModel['memory'] };


    const base: Omit<UnifiedUrlModel, 'derived' | 'enterpriseScore'> = {
      meta: perf.meta,
      performance: perf.payload.navigation,
      accessibility: a11y.payload,
      coreWebVitals: coreWebVitals.payload,
      lighthouse: lighthouse.payload,
      throttled: throttled.payload,
      security: security.payload,
      seo: seo.payload,
      visualRegression: visualRegression.payload,
      brokenLinks: brokenLinks.payload,
      thirdPartyRisk: thirdPartyRisk.payload,
      accessibilityBeyondAxe: accessibilityBeyondAxe.payload,
      stability: stability.payload,
      memory: memory.payload
    };

    const derived = computeDerived(base);
    urls.push({ ...base, derived, enterpriseScore: computeEnterpriseScores(derived, base) });
  }

  const rankings = {
    performance: [...urls].sort((a, b) => b.derived.performanceCompositeScore - a.derived.performanceCompositeScore).map((entry) => ({ url: entry.meta.url, score: entry.derived.performanceCompositeScore })),
    accessibility: [...urls].sort((a, b) => b.derived.accessibilityWeightedScore - a.derived.accessibilityWeightedScore).map((entry) => ({ url: entry.meta.url, score: entry.derived.accessibilityWeightedScore }))
  };

  return {
    runId,
    timestamp,
    toolVersion,
    schemaVersion,
    urls,
    summary: {
      totalUrls: urls.length,
      generatedAt: new Date().toISOString(),
      rankings
    }
  };
}

export function percentileSummary(values: number[]): { p50: number; p75: number; p95: number } {
  return { p50: percentile(values, 50), p75: percentile(values, 75), p95: percentile(values, 95) };
}
