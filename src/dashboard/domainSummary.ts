import type { ArtifactStore, DashboardIndex } from './data.js';

export interface Coverage {
  measured: number;
  total: number;
}

export interface DomainSummary {
  runId: string;
  totals: { urls: number };
  accessibility: { counts: Record<string, number>; totalIssues: number; coverage: Coverage };
  fcp: { avgSeconds: number | null; minSeconds: number | null; maxSeconds: number | null; coverage: Coverage };
  brokenLinks: { broken: number; total: number; rate: number | null; coverage: Coverage };
  seoScore: { avg: number | null; min: number | null; max: number | null; coverage: Coverage };
  coreWebVitals: { good: number; needsImprovement: number; poor: number; coverage: Coverage };
  clientErrors: { totalErrors: number; affectedUrls: number; coverage: Coverage };
  security: { severities: Record<string, number>; totalFindings: number; coverage: Coverage };
  visualRegression: { changedUrls: number; avgDiffRatio: number | null; baselineFound: number; coverage: Coverage };
}

const asRecord = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {});
const toNum = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

function unwrap(raw: unknown): Record<string, unknown> {
  const obj = asRecord(raw);
  if ('payload' in obj) return asRecord(obj.payload);
  return obj;
}

function avg(values: number[]): number | null { return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null; }

function classifyCwv(value: number | null, goodMax: number, niMax: number): 'good' | 'needsImprovement' | 'poor' | 'missing' {
  if (value === null) return 'missing';
  if (value <= goodMax) return 'good';
  if (value <= niMax) return 'needsImprovement';
  return 'poor';
}

export async function buildDomainSummary(index: DashboardIndex, store: ArtifactStore, runId: string): Promise<DomainSummary> {
  const total = index.urls.length;
  const a11yCounts: Record<string, number> = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  let a11yCoverage = 0;

  const fcpValues: number[] = [];
  let fcpCoverage = 0;

  let broken = 0;
  let totalLinks = 0;
  let brokenCoverage = 0;

  const seoValues: number[] = [];
  let seoCoverage = 0;

  let cwvCoverage = 0;
  let cwvGood = 0;
  let cwvNeedsImprovement = 0;
  let cwvPoor = 0;

  let clientCoverage = 0;
  let totalClientErrors = 0;
  let clientAffectedUrls = 0;

  let securityCoverage = 0;
  const securitySeverities: Record<string, number> = {};

  let visualCoverage = 0;
  let visualChangedUrls = 0;
  let visualBaselineFound = 0;
  const visualDiffs: number[] = [];

  for (const url of index.urls) {
    const [a11yLoaded, perfLoaded, brokenLoaded, seoLoaded, cwvLoaded, stabilityLoaded, securityLoaded, visualLoaded] = await Promise.all([
      store.loadSection(url.id, 'accessibility.json'),
      store.loadSection(url.id, 'performance.json'),
      store.loadSection(url.id, 'broken-links.json'),
      store.loadSection(url.id, 'seo-score.json'),
      store.loadSection(url.id, 'core-web-vitals.json'),
      store.loadSection(url.id, 'stability.json'),
      store.loadSection(url.id, 'security-scan.json'),
      store.loadSection(url.id, 'visual-regression.json')
    ]);

    if (a11yLoaded.state === 'ok' || a11yLoaded.state === 'issues') {
      const data = unwrap(a11yLoaded.raw);
      const counters = asRecord(data.counters);
      a11yCounts.critical += toNum(counters.critical ?? data.critical) ?? 0;
      a11yCounts.serious += toNum(counters.serious ?? data.serious) ?? 0;
      a11yCounts.moderate += toNum(counters.moderate ?? data.moderate) ?? 0;
      a11yCounts.minor += toNum(counters.minor ?? data.minor) ?? 0;
      a11yCoverage += 1;
    }

    if (perfLoaded.state === 'ok' || perfLoaded.state === 'issues') {
      const perf = unwrap(perfLoaded.raw);
      const paint = asRecord(perf.paint);
      const fcpMs = toNum(paint.fcpMs ?? paint['first-contentful-paint']);
      if (fcpMs !== null) {
        fcpValues.push(fcpMs / 1000);
        fcpCoverage += 1;
      }
    }

    if (brokenLoaded.state === 'ok' || brokenLoaded.state === 'issues') {
      const links = unwrap(brokenLoaded.raw);
      const brokenCount = toNum(links.brokenCount ?? links.broken);
      const checkedCount = toNum(links.checkedCount ?? links.totalLinks ?? links.checked);
      if (brokenCount !== null || checkedCount !== null) {
        broken += brokenCount ?? 0;
        totalLinks += checkedCount ?? 0;
        brokenCoverage += 1;
      }
    }

    if (seoLoaded.state === 'ok' || seoLoaded.state === 'issues') {
      const seo = unwrap(seoLoaded.raw);
      const score = toNum(seo.overallScore ?? seo.score);
      if (score !== null) {
        seoValues.push(score);
        seoCoverage += 1;
      }
    }

    if (cwvLoaded.state === 'ok' || cwvLoaded.state === 'issues') {
      const cwv = unwrap(cwvLoaded.raw);
      const lcp = toNum(cwv.lcpSeconds) ?? ((toNum(cwv.lcpMs ?? cwv.lcp) ?? NaN) / 1000);
      const cls = toNum(cwv.cls);
      const inp = toNum(cwv.inpMs ?? cwv.inp);
      const lcpClass = classifyCwv(Number.isFinite(lcp) ? lcp : null, 2.5, 4.0);
      const clsClass = classifyCwv(cls, 0.1, 0.25);
      const inpClass = classifyCwv(inp, 200, 500);
      if (lcpClass !== 'missing' && clsClass !== 'missing' && inpClass !== 'missing') {
        cwvCoverage += 1;
        if (lcpClass === 'good' && clsClass === 'good' && inpClass === 'good') cwvGood += 1;
        else if (lcpClass === 'poor' || clsClass === 'poor' || inpClass === 'poor') cwvPoor += 1;
        else cwvNeedsImprovement += 1;
      }
    }

    if (stabilityLoaded.state === 'ok' || stabilityLoaded.state === 'issues') {
      const stability = unwrap(stabilityLoaded.raw);
      const totalErrors = toNum(stability.totalErrors ?? stability.consoleErrors ?? stability.errors);
      if (totalErrors !== null) {
        clientCoverage += 1;
        totalClientErrors += totalErrors;
        if (totalErrors > 0) clientAffectedUrls += 1;
      }
    }

    if (securityLoaded.state === 'ok' || securityLoaded.state === 'issues') {
      const security = unwrap(securityLoaded.raw);
      const findings = Array.isArray(security.findings) ? security.findings : Array.isArray(security.issues) ? security.issues : [];
      if (findings.length) {
        securityCoverage += 1;
        for (const finding of findings) {
          const sev = String(asRecord(finding).severity ?? asRecord(finding).level ?? 'unknown').toLowerCase();
          securitySeverities[sev] = (securitySeverities[sev] ?? 0) + 1;
        }
      } else if (Array.isArray(security.missingHeaders)) {
        securityCoverage += 1;
        securitySeverities.info = (securitySeverities.info ?? 0) + security.missingHeaders.length;
      }
    }

    if (visualLoaded.state === 'ok' || visualLoaded.state === 'issues' || visualLoaded.state === 'not_available') {
      const visual = unwrap(visualLoaded.raw);
      const diffRatio = toNum(visual.diffRatio ?? visual.diffScore);
      const threshold = toNum(visual.threshold ?? visual.diffThreshold) ?? 0;
      const baselineFound = visual.baselineFound !== false;
      if (baselineFound) visualBaselineFound += 1;
      if (diffRatio !== null) {
        visualDiffs.push(diffRatio);
        visualCoverage += 1;
        if (diffRatio > threshold || visual.passed === false) visualChangedUrls += 1;
      }
    }
  }

  const a11yTotalIssues = Object.values(a11yCounts).reduce((sum, value) => sum + value, 0);
  const securityTotal = Object.values(securitySeverities).reduce((sum, value) => sum + value, 0);

  return {
    runId,
    totals: { urls: total },
    accessibility: { counts: a11yCounts, totalIssues: a11yTotalIssues, coverage: { measured: a11yCoverage, total } },
    fcp: {
      avgSeconds: avg(fcpValues),
      minSeconds: fcpValues.length ? Math.min(...fcpValues) : null,
      maxSeconds: fcpValues.length ? Math.max(...fcpValues) : null,
      coverage: { measured: fcpCoverage, total }
    },
    brokenLinks: { broken, total: totalLinks, rate: totalLinks > 0 ? (broken / totalLinks) * 100 : null, coverage: { measured: brokenCoverage, total } },
    seoScore: { avg: avg(seoValues), min: seoValues.length ? Math.min(...seoValues) : null, max: seoValues.length ? Math.max(...seoValues) : null, coverage: { measured: seoCoverage, total } },
    coreWebVitals: { good: cwvGood, needsImprovement: cwvNeedsImprovement, poor: cwvPoor, coverage: { measured: cwvCoverage, total } },
    clientErrors: { totalErrors: totalClientErrors, affectedUrls: clientAffectedUrls, coverage: { measured: clientCoverage, total } },
    security: { severities: securitySeverities, totalFindings: securityTotal, coverage: { measured: securityCoverage, total } },
    visualRegression: { changedUrls: visualChangedUrls, avgDiffRatio: avg(visualDiffs), baselineFound: visualBaselineFound, coverage: { measured: visualCoverage, total } }
  };
}
