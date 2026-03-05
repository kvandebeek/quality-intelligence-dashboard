import fs from 'node:fs/promises';
import path from 'node:path';
import type { ArtifactStore, DashboardIndex } from './data.js';

export interface Coverage {
  measured: number;
  total: number;
}

export interface DomainSummary {
  runId: string;
  runPath: string;
  startUrl: string | null;
  domain: string | null;
  totals: { urls: number };
  accessibility: { counts: Record<string, number>; totalIssues: number; coverage: Coverage };
  fcp: { avgSeconds: number | null; minSeconds: number | null; maxSeconds: number | null; coverage: Coverage; issues: number; intermittent: number };
  brokenLinks: { broken: number; total: number; rate: number | null; coverage: Coverage };
  seoScore: { avg: number | null; min: number | null; max: number | null; coverage: Coverage };
  coreWebVitals: {
    state: 'not-collected' | 'empty' | 'has-data';
    good: number;
    needsImprovement: number;
    poor: number;
    coverage: Coverage;
    metrics: {
      lcp: { good: number; measured: number; medianMs: number | null };
      inp: { good: number; measured: number; medianMs: number | null };
      cls: { good: number; measured: number; median: number | null };
    };
  };
  clientErrors: { totalErrors: number; affectedUrls: number; coverage: Coverage };
  security: {
    state: 'ok-empty' | 'ok-has-findings' | 'not-collected' | 'error';
    severities: Record<string, number>;
    totalFindings: number;
    coverage: Coverage;
  };
  uxSummary: {
    state: 'not-collected' | 'empty' | 'has-issues';
    passingUrls: number;
    failingUrls: number;
    topIssues: Array<{ id: string; title: string; count: number }>;
    coverage: Coverage;
  };
  crossBrowserPerformance: {
    state: 'untested' | 'partial' | 'tested';
    testedUrls: number;
    untestedUrls: number;
    coverage: Coverage;
  };
}

const asRecord = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {});
const toNum = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

function unwrap(raw: unknown): Record<string, unknown> {
  const obj = asRecord(raw);
  if ('payload' in obj) return asRecord(obj.payload);
  return obj;
}

function avg(values: number[]): number | null { return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null; }
function median(values: number[]): number | null { if (!values.length) return null; const sorted = [...values].sort((a,b)=>a-b); const mid = Math.floor(sorted.length/2); return sorted.length % 2 ? sorted[mid] ?? null : (((sorted[mid-1] ?? 0) + (sorted[mid] ?? 0)) / 2); }

function classifyCwv(value: number | null, goodMax: number, niMax: number): 'good' | 'needsImprovement' | 'poor' | 'missing' {
  if (value === null) return 'missing';
  if (value <= goodMax) return 'good';
  if (value <= niMax) return 'needsImprovement';
  return 'poor';
}

function parseHostname(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    return new URL(value).hostname || null;
  } catch {
    try {
      return new URL(`https://${value}`).hostname || null;
    } catch {
      return null;
    }
  }
}

function readStartUrlCandidate(candidate: unknown): string | null {
  const source = asRecord(candidate);
  const startUrl = source.startUrl ?? source.startURL ?? source.start_url;
  return typeof startUrl === 'string' && startUrl.trim() ? startUrl.trim() : null;
}

async function resolveDomainMetadata(index: DashboardIndex, store: ArtifactStore): Promise<{ startUrl: string | null; domain: string | null }> {
  let startUrl: string | null = null;

  const runMetadataPath = path.join(index.runPath, 'run-metadata.json');
  try {
    await fs.access(runMetadataPath);
    const rootMetadata = await store.readJson(runMetadataPath);
    if (rootMetadata.ok) {
      startUrl = readStartUrlCandidate(rootMetadata.data);
    }
  } catch {
    // optional root metadata
  }

  if (!startUrl) {
    const firstUrl = index.urls[0];
    if (firstUrl) {
      const targetLoaded = await store.loadSection(firstUrl.id, 'target-summary.json');
      const target = unwrap(targetLoaded.raw);
      startUrl = readStartUrlCandidate(target) ?? readStartUrlCandidate(target.payload) ?? readStartUrlCandidate(target.meta);
    }
  }

  if (!startUrl) startUrl = typeof index.urls[0]?.url === 'string' ? index.urls[0].url : null;
  return { startUrl, domain: parseHostname(startUrl) };
}

export async function buildDomainSummary(index: DashboardIndex, store: ArtifactStore, runId: string): Promise<DomainSummary> {
  const domainMetadata = await resolveDomainMetadata(index, store);
  const total = index.urls.length;
  const a11yCounts: Record<string, number> = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  let a11yCoverage = 0;

  const fcpValues: number[] = [];
  let fcpCoverage = 0;
  let fcpIssues = 0;
  let fcpIntermittent = 0;

  let broken = 0;
  let totalLinks = 0;
  let brokenCoverage = 0;

  const seoValues: number[] = [];
  let seoCoverage = 0;

  let cwvCoverage = 0;
  let cwvGood = 0;
  let cwvNeedsImprovement = 0;
  let cwvPoor = 0;
  let lcpGood = 0;
  let lcpMeasured = 0;
  const lcpValuesMs: number[] = [];
  let inpGood = 0;
  let inpMeasured = 0;
  const inpValuesMs: number[] = [];
  let clsGood = 0;
  let clsMeasured = 0;
  const clsValues: number[] = [];

  let clientCoverage = 0;
  let totalClientErrors = 0;
  let clientAffectedUrls = 0;

  let securityCoverage = 0;
  const securitySeverities: Record<string, number> = {};

  let uxCoverage = 0;
  let uxPassingUrls = 0;
  let uxFailingUrls = 0;
  const uxIssues = new Map<string, { id: string; title: string; count: number }>();
  let crossBrowserTested = 0;
  let crossBrowserUntested = 0;

  for (const url of index.urls) {
    const [a11yLoaded, perfLoaded, brokenLoaded, seoLoaded, cwvLoaded, stabilityLoaded, securityLoaded, uxLoaded, crossBrowserLoaded] = await Promise.all([
      store.loadSection(url.id, 'accessibility.json'),
      store.loadSection(url.id, 'performance.json'),
      store.loadSection(url.id, 'broken-links.json'),
      store.loadSection(url.id, 'seo-score.json'),
      store.loadSection(url.id, 'core-web-vitals.json'),
      store.loadSection(url.id, 'stability.json'),
      store.loadSection(url.id, 'security-scan.json'),
      store.loadSection(url.id, 'ux-overview.json'),
      store.loadSection(url.id, 'cross-browser-performance.json')
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
      const fcpMs = toNum(perf.fcpReportedMs ?? paint.fcpMs ?? paint['first-contentful-paint']);
      if (fcpMs !== null) {
        fcpValues.push(fcpMs / 1000);
        fcpCoverage += 1;
      }
      const attempts = Array.isArray(perf.fcpAttempts) ? perf.fcpAttempts : [];
      const measuredAttempts = attempts.map((entry) => toNum(asRecord(entry).fcpMs)).filter((value): value is number => value !== null);
      const slowAttempts = measuredAttempts.filter((value) => value > 3000).length;
      const medianIssue = toNum(perf.fcpReportedMs) !== null && (toNum(perf.fcpReportedMs) as number) > 3000;
      if (Boolean(perf.fcpIssue) || medianIssue || slowAttempts >= 2) fcpIssues += 1;
      if (measuredAttempts.length >= 2 && slowAttempts > 0 && slowAttempts < measuredAttempts.length) fcpIntermittent += 1;
    }

    if (brokenLoaded.state === 'ok' || brokenLoaded.state === 'issues') {
      const links = unwrap(brokenLoaded.raw);
      const summary = asRecord(links.summary);
      const brokenCount = toNum(summary.broken ?? links.brokenCount ?? links.broken);
      const checkedCount = toNum(summary.checked ?? links.checkedCount ?? links.totalLinks ?? links.checked);
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
      if (lcpClass !== 'missing') {
        lcpMeasured += 1;
        lcpValuesMs.push(Math.round((lcp ?? 0) * 1000));
        if (lcpClass === 'good') lcpGood += 1;
      }
      if (clsClass !== 'missing') {
        clsMeasured += 1;
        clsValues.push(cls ?? 0);
        if (clsClass === 'good') clsGood += 1;
      }
      if (inpClass !== 'missing') {
        inpMeasured += 1;
        inpValuesMs.push(inp ?? 0);
        if (inpClass === 'good') inpGood += 1;
      }
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
      securityCoverage += 1;
      const findings = Array.isArray(security.findings)
        ? security.findings
        : Array.isArray(security.issues)
          ? security.issues
          : Array.isArray(security.vulnerabilities)
            ? security.vulnerabilities
            : [];
      if (findings.length) {
        for (const finding of findings) {
          const row = asRecord(finding);
          const sev = String(row.severity ?? row.level ?? row.risk ?? 'unknown').toLowerCase();
          securitySeverities[sev] = (securitySeverities[sev] ?? 0) + 1;
        }
      } else if (Array.isArray(security.severities)) {
        for (const entry of security.severities) {
          const row = asRecord(entry);
          const sev = String(row.label ?? row.severity ?? row.level ?? 'unknown').toLowerCase();
          const count = toNum(row.count) ?? 0;
          securitySeverities[sev] = (securitySeverities[sev] ?? 0) + count;
        }
      } else if (typeof security.severities === 'object' && security.severities !== null) {
        for (const [sev, value] of Object.entries(asRecord(security.severities))) {
          securitySeverities[String(sev).toLowerCase()] = (securitySeverities[String(sev).toLowerCase()] ?? 0) + (toNum(value) ?? 0);
        }
      }
      if (Array.isArray(security.missingHeaders)) {
        securitySeverities.info = (securitySeverities.info ?? 0) + security.missingHeaders.length;
      }
    } else if (securityLoaded.state === 'error') {
      securityCoverage += 1;
    }

    if (uxLoaded.state === 'ok' || uxLoaded.state === 'issues') {
      const ux = unwrap(uxLoaded.raw);
      const topIssues = Array.isArray(ux.topIssues) ? ux.topIssues : [];
      uxCoverage += 1;
      if (topIssues.length > 0) uxFailingUrls += 1;
      else uxPassingUrls += 1;
      for (const issue of topIssues) {
        const row = asRecord(issue);
        const id = String(row.id ?? row.code ?? 'issue');
        const title = String(row.title ?? row.description ?? id);
        const key = `${id}:${title}`;
        uxIssues.set(key, { id, title, count: (uxIssues.get(key)?.count ?? 0) + 1 });
      }
    }


    if (crossBrowserLoaded.state === 'ok') {
      const crossBrowser = unwrap(crossBrowserLoaded.raw);
      const payload = asRecord(crossBrowser.crossBrowserPerformance);
      if (String(payload.status) === 'tested') crossBrowserTested += 1;
      else crossBrowserUntested += 1;
    } else if (crossBrowserLoaded.state === 'not_available') {
      crossBrowserUntested += 1;
    }
  }

  const a11yTotalIssues = Object.values(a11yCounts).reduce((sum, value) => sum + value, 0);
  const securityTotal = Object.values(securitySeverities).reduce((sum, value) => sum + value, 0);
  const securityState = securityCoverage === 0
    ? 'not-collected'
    : securityTotal === 0
      ? 'ok-empty'
      : 'ok-has-findings';
  const cwvState = cwvCoverage === 0 ? (total === 0 ? 'empty' : 'not-collected') : 'has-data';

  const uxTopIssues = [...uxIssues.values()].sort((a, b) => b.count - a.count || a.id.localeCompare(b.id)).slice(0, 3);
  const uxState = uxCoverage === 0 ? (total === 0 ? 'empty' : 'not-collected') : uxFailingUrls > 0 ? 'has-issues' : 'empty';

  return {
    runId,
    runPath: path.relative(process.cwd(), index.runPath) || '.',
    startUrl: domainMetadata.startUrl,
    domain: domainMetadata.domain,
    totals: { urls: total },
    accessibility: { counts: a11yCounts, totalIssues: a11yTotalIssues, coverage: { measured: a11yCoverage, total } },
    fcp: {
      avgSeconds: avg(fcpValues),
      minSeconds: fcpValues.length ? Math.min(...fcpValues) : null,
      maxSeconds: fcpValues.length ? Math.max(...fcpValues) : null,
      coverage: { measured: fcpCoverage, total },
      issues: fcpIssues,
      intermittent: fcpIntermittent
    },
    brokenLinks: { broken, total: totalLinks, rate: totalLinks > 0 ? (broken / totalLinks) * 100 : null, coverage: { measured: brokenCoverage, total } },
    seoScore: { avg: avg(seoValues), min: seoValues.length ? Math.min(...seoValues) : null, max: seoValues.length ? Math.max(...seoValues) : null, coverage: { measured: seoCoverage, total } },
    coreWebVitals: {
      state: cwvState,
      good: cwvGood,
      needsImprovement: cwvNeedsImprovement,
      poor: cwvPoor,
      coverage: { measured: cwvCoverage, total },
      metrics: {
        lcp: { good: lcpGood, measured: lcpMeasured, medianMs: median(lcpValuesMs) },
        inp: { good: inpGood, measured: inpMeasured, medianMs: median(inpValuesMs) },
        cls: { good: clsGood, measured: clsMeasured, median: median(clsValues) }
      }
    },
    clientErrors: { totalErrors: totalClientErrors, affectedUrls: clientAffectedUrls, coverage: { measured: clientCoverage, total } },
    security: { state: securityState, severities: securitySeverities, totalFindings: securityTotal, coverage: { measured: securityCoverage, total } },
    uxSummary: { state: uxState, passingUrls: uxPassingUrls, failingUrls: uxFailingUrls, topIssues: uxTopIssues, coverage: { measured: uxCoverage, total } },
    crossBrowserPerformance: {
      state: crossBrowserTested === 0 ? 'untested' : (crossBrowserUntested > 0 ? 'partial' : 'tested'),
      testedUrls: crossBrowserTested,
      untestedUrls: crossBrowserUntested,
      coverage: { measured: crossBrowserTested + crossBrowserUntested, total }
    }
  };
}
