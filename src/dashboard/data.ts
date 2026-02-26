import fs from 'node:fs/promises';
import path from 'node:path';
import { CATEGORY_WEIGHTS, CWV_THRESHOLDS, SCORE_THRESHOLDS, type StatusValue } from './config.js';

export interface RunPathOptions { cliRunPath?: string; envRunPath?: string }
export function resolveRunPath(options: RunPathOptions): string {
  const value = options.cliRunPath ?? options.envRunPath;
  return value ? path.resolve(value) : process.cwd();
}

type JsonObject = Record<string, unknown>;

export interface ValidationEntry { scope: 'global' | 'url'; id: string; found: string[]; missing: string[] }

export interface UrlModel {
  id: string;
  url: string;
  artifacts: Record<string, unknown>;
  images: Record<string, string>;
  categoryScores: Record<string, { value: number; derived: boolean }>;
  overallScore: number;
  grade: string;
  status: StatusValue;
  blockers: string[];
  regressions: number;
  environment: string;
  lastRunAt: string;
  hasThrottled: boolean;
}

export interface DashboardRunData {
  runPath: string;
  globalArtifacts: Record<string, unknown>;
  urls: UrlModel[];
  validation: ValidationEntry[];
}

const GLOBAL_FILES = ['index.json', 'summary-index.json', 'history.json', 'ci-summary.json', 'run-metadata.json', 'junit.xml'];
const URL_FILES = [
  'target-summary.json','lighthouse-summary.json','performance.json','core-web-vitals.json','throttled-run.json','memory-profile.json','network-requests.json',
  'network-recommendations.json','accessibility.json','a11y-beyond-axe.json','security-scan.json','third-party-risk.json','stability.json','broken-links.json',
  'api-monitoring.json','seo-checks.json','visual-regression.json'
];

async function readJsonSafe(filePath: string): Promise<unknown | undefined> {
  try { return JSON.parse(await fs.readFile(filePath, 'utf8')); } catch { return undefined; }
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function grade(score: number): string { return score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F'; }

function cwvBlockers(cwv: JsonObject): string[] {
  const out: string[] = [];
  const metrics: Record<string, number> = {
    lcp: num(cwv.lcpMs ?? cwv.lcp),
    cls: num(cwv.cls),
    inp: num(cwv.inpMs ?? cwv.fidMs ?? cwv.inp),
    ttfb: num(cwv.ttfbMs ?? cwv.ttfb)
  };
  (Object.keys(metrics) as Array<keyof typeof metrics>).forEach((k) => {
    const poor = CWV_THRESHOLDS[k as keyof typeof CWV_THRESHOLDS].poor;
    if (metrics[k] > poor * SCORE_THRESHOLDS.blockerCwvMultiplier) out.push(`CWV ${k.toUpperCase()} critical`);
  });
  return out;
}

function normalizeUrl(urlArtifact: Record<string, unknown>, id: string): string {
  return String(urlArtifact.url ?? (urlArtifact.target as JsonObject | undefined)?.url ?? id);
}

function getLighthouseScores(artifacts: Record<string, unknown>): Record<string, number> {
  const l = (artifacts['lighthouse-summary.json'] as JsonObject | undefined) ?? (artifacts['target-summary.json'] as JsonObject | undefined)?.lighthouse as JsonObject | undefined;
  if (!l) return {};
  return {
    performance: Math.round(num(l.performance) * (num(l.performance) <= 1 ? 100 : 1)),
    accessibility: Math.round(num(l.accessibility) * (num(l.accessibility) <= 1 ? 100 : 1)),
    seo: Math.round(num(l.seo) * (num(l.seo) <= 1 ? 100 : 1)),
    bestPractices: Math.round(num(l.bestPractices ?? l['best-practices']) * (num(l.bestPractices ?? l['best-practices']) <= 1 ? 100 : 1))
  };
}

function computeCategoryScores(artifacts: Record<string, unknown>): Record<string, { value: number; derived: boolean }> {
  const lighthouse = getLighthouseScores(artifacts);
  const a11y = artifacts['accessibility.json'] as JsonObject | undefined;
  const security = artifacts['security-scan.json'] as JsonObject | undefined;
  const stability = artifacts['stability.json'] as JsonObject | undefined;
  const seo = artifacts['seo-checks.json'] as JsonObject | undefined;
  const visual = artifacts['visual-regression.json'] as JsonObject | undefined;
  const perf = artifacts['performance.json'] as JsonObject | undefined;

  const a11yViolations = num(a11y?.totalViolations ?? a11y?.violationsCount);
  const secCritical = num(security?.criticalCount ?? security?.critical ?? security?.criticalFindings);
  const secHigh = num(security?.highCount ?? security?.high ?? security?.highFindings);
  const stableFailures = num(stability?.errorCount ?? stability?.failures ?? stability?.jsErrors);
  const seoIssues = num(seo?.issueCount ?? seo?.errors ?? seo?.missingCount);
  const visualDiff = num(visual?.diffScore ?? visual?.difference ?? visual?.score);
  const loadEvent = num((perf?.navigation as JsonObject | undefined)?.loadEventMs ?? perf?.loadEventMs, 4000);

  const score = {
    performance: lighthouse.performance ? { value: lighthouse.performance, derived: false } : { value: Math.max(0, 100 - Math.round(loadEvent / 100)), derived: true },
    accessibility: lighthouse.accessibility ? { value: lighthouse.accessibility, derived: false } : { value: Math.max(0, 100 - a11yViolations * 4), derived: true },
    security: { value: Math.max(0, 100 - secCritical * 30 - secHigh * 12), derived: true },
    stability: { value: Math.max(0, 100 - stableFailures * 8), derived: true },
    seo: lighthouse.seo ? { value: lighthouse.seo, derived: false } : { value: Math.max(0, 100 - seoIssues * 10), derived: true },
    visual: { value: Math.max(0, 100 - visualDiff), derived: true },
    bestPractices: lighthouse.bestPractices ? { value: lighthouse.bestPractices, derived: false } : { value: 70, derived: true }
  };
  return score;
}

function computeStatus(artifacts: Record<string, unknown>, overallScore: number, regressions: number): { status: StatusValue; blockers: string[] } {
  const blockers: string[] = [];
  const cwv = artifacts['core-web-vitals.json'] as JsonObject | undefined;
  const ci = artifacts['_global_ci'] as JsonObject | undefined;
  const sec = artifacts['security-scan.json'] as JsonObject | undefined;
  const api = artifacts['api-monitoring.json'] as JsonObject | undefined;
  const stability = artifacts['stability.json'] as JsonObject | undefined;

  if (cwv) blockers.push(...cwvBlockers(cwv));
  if (num(sec?.criticalCount ?? sec?.critical) >= SCORE_THRESHOLDS.blockerSecurityCritical) blockers.push('Security critical findings');
  if (num(api?.failureRate) > SCORE_THRESHOLDS.blockerApiFailureRate) blockers.push('High API failure rate');
  if (num(stability?.jsConsoleErrors ?? stability?.consoleErrors) > SCORE_THRESHOLDS.blockerConsoleErrors) blockers.push('Excessive console errors');
  if (String(ci?.qualityGate ?? ci?.status ?? '').toUpperCase() === 'FAIL') blockers.push('CI quality gate fail');

  if (blockers.length > 0) return { status: 'FAIL', blockers };
  if (overallScore < SCORE_THRESHOLDS.pass || regressions >= SCORE_THRESHOLDS.regressionWarnCount) return { status: 'WARN', blockers };
  return { status: 'PASS', blockers };
}

export async function loadDashboardRun(runPath: string): Promise<DashboardRunData> {
  const entries = await fs.readdir(runPath, { withFileTypes: true });
  const globals: Record<string, unknown> = {};
  const validation: ValidationEntry[] = [];
  for (const g of GLOBAL_FILES) {
    const content = await readJsonSafe(path.join(runPath, g));
    if (content !== undefined) globals[g] = content;
  }

  const ciSummary = (globals['ci-summary.json'] as JsonObject | undefined) ?? {};
  const runMeta = (globals['run-metadata.json'] as JsonObject | undefined) ?? {};
  const history = (globals['history.json'] as JsonObject | undefined) ?? {};

  const folders = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'baseline').map((e) => e.name).sort();
  const urls: UrlModel[] = [];

  for (const id of folders) {
    const folderPath = path.join(runPath, id);
    const folderEntries = await fs.readdir(folderPath, { withFileTypes: true });
    const artifacts: Record<string, unknown> = { _global_ci: ciSummary };
    const found: string[] = [];
    const missing: string[] = [];
    const images: Record<string, string> = {};

    for (const file of URL_FILES) {
      const value = await readJsonSafe(path.join(folderPath, file));
      if (value !== undefined) { artifacts[file] = value; found.push(file); }
      else missing.push(file);
    }
    for (const fe of folderEntries) {
      if (fe.isFile() && /\.(png|jpg|jpeg|webp|gif)$/i.test(fe.name)) {
        images[fe.name] = `/artifacts/${encodeURIComponent(id)}/${encodeURIComponent(fe.name)}`;
      }
    }

    const categoryScores = computeCategoryScores(artifacts);
    const overallScore = Math.round(
      categoryScores.performance.value * CATEGORY_WEIGHTS.performance +
      categoryScores.accessibility.value * CATEGORY_WEIGHTS.accessibility +
      categoryScores.security.value * CATEGORY_WEIGHTS.security +
      categoryScores.stability.value * CATEGORY_WEIGHTS.stability +
      categoryScores.seo.value * CATEGORY_WEIGHTS.seo +
      categoryScores.visual.value * CATEGORY_WEIGHTS.visual
    );
    const regressions = num((history[id] as JsonObject | undefined)?.regressions ?? (artifacts['visual-regression.json'] as JsonObject | undefined)?.regressions);
    const statusState = computeStatus(artifacts, overallScore, regressions);

    urls.push({
      id,
      url: normalizeUrl((artifacts['target-summary.json'] as JsonObject | undefined) ?? {}, id),
      artifacts,
      images,
      categoryScores,
      overallScore,
      grade: grade(overallScore),
      status: statusState.status,
      blockers: statusState.blockers,
      regressions,
      environment: String(runMeta.environment ?? runMeta.env ?? 'Not available'),
      lastRunAt: String(runMeta.finishedAt ?? runMeta.timestamp ?? 'Not available'),
      hasThrottled: Boolean(artifacts['throttled-run.json'])
    });

    validation.push({ scope: 'url', id, found, missing });
  }

  validation.push({ scope: 'global', id: 'run', found: Object.keys(globals), missing: GLOBAL_FILES.filter((g) => globals[g] === undefined) });
  process.stdout.write(`[dashboard] discovered ${urls.length} URL folders\n`);
  for (const v of validation) process.stdout.write(`[dashboard] ${v.scope}:${v.id} found=${v.found.length} missing=${v.missing.length}\n`);
  return { runPath, globalArtifacts: globals, urls, validation };
}

// Backward-compatible summary helpers used by tests
export interface OverviewRow { folderName: string; url: string; critical: number; serious: number; moderate: number; minor: number; ttfbMs: number; dclMs: number; loadEventMs: number; totalTransferSize: number; resourceCount: number; requestCount: number; failedRequestCount: number; networkTransferSize: number; slowestRequestMs: number; recommendationCounts: Record<string, number>; accessibilityIssues: unknown[]; networkRequests: JsonObject[]; networkRecommendations: JsonObject[] }
export interface RunSummaryMetrics { totalPages: number; accessibilityTotals: { critical: number; serious: number; moderate: number; minor: number }; worstByLoadEventMs: OverviewRow[]; worstByCriticalIssues: OverviewRow[]; worstByTransferSize: OverviewRow[] }

export function toOverviewRows(data: DashboardRunData): OverviewRow[] {
  return data.urls.map((u) => {
    const a11y = u.artifacts['accessibility.json'] as JsonObject | undefined;
    const perf = u.artifacts['performance.json'] as JsonObject | undefined;
    const requests = (u.artifacts['network-requests.json'] as JsonObject[] | undefined) ?? [];
    const recs = (u.artifacts['network-recommendations.json'] as JsonObject[] | undefined) ?? [];
    return {
      folderName: u.id,
      url: u.url,
      critical: num((a11y?.counters as JsonObject | undefined)?.critical ?? a11y?.critical),
      serious: num((a11y?.counters as JsonObject | undefined)?.serious ?? a11y?.serious),
      moderate: num((a11y?.counters as JsonObject | undefined)?.moderate ?? a11y?.moderate),
      minor: num((a11y?.counters as JsonObject | undefined)?.minor ?? a11y?.minor),
      ttfbMs: num((perf?.navigation as JsonObject | undefined)?.ttfbMs),
      dclMs: num((perf?.navigation as JsonObject | undefined)?.domContentLoadedMs),
      loadEventMs: num((perf?.navigation as JsonObject | undefined)?.loadEventMs),
      totalTransferSize: num((perf?.resourceSummary as JsonObject | undefined)?.transferSize),
      resourceCount: num((perf?.resourceSummary as JsonObject | undefined)?.count),
      requestCount: requests.length,
      failedRequestCount: requests.filter((r) => num(r.status, 200) >= 400).length,
      networkTransferSize: requests.reduce((a, r) => a + num(r.transferSize), 0),
      slowestRequestMs: requests.reduce((a, r) => Math.max(a, num(r.durationMs)), 0),
      recommendationCounts: recs.reduce<Record<string, number>>((acc, rec) => { const k = String(rec.severity ?? 'unknown'); acc[k] = (acc[k] ?? 0) + 1; return acc; }, {}),
      accessibilityIssues: (a11y?.issues as unknown[] | undefined) ?? [],
      networkRequests: requests,
      networkRecommendations: recs
    };
  });
}

function worst(rows: readonly OverviewRow[], metric: (row: OverviewRow) => number): OverviewRow[] {
  return [...rows].sort((a, b) => metric(b) - metric(a) || a.url.localeCompare(b.url)).slice(0, 5);
}

export function computeRunSummary(rows: readonly OverviewRow[]): RunSummaryMetrics {
  const totals = rows.reduce((acc, r) => ({ critical: acc.critical + r.critical, serious: acc.serious + r.serious, moderate: acc.moderate + r.moderate, minor: acc.minor + r.minor }), { critical: 0, serious: 0, moderate: 0, minor: 0 });
  return { totalPages: rows.length, accessibilityTotals: totals, worstByLoadEventMs: worst(rows, (r) => r.loadEventMs), worstByCriticalIssues: worst(rows, (r) => r.critical), worstByTransferSize: worst(rows, (r) => r.totalTransferSize) };
}
