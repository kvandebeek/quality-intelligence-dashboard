import fs from 'node:fs/promises';
import path from 'node:path';

export interface RunPathOptions { cliRunPath?: string; envRunPath?: string }
export function resolveRunPath(options: RunPathOptions): string {
  const value = options.cliRunPath ?? options.envRunPath;
  return value ? path.resolve(value) : process.cwd();
}

type JsonValue = Record<string, unknown> | unknown[];

type SectionFile =
  | 'a11y-beyond-axe.json'
  | 'accessibility.json'
  | 'api-monitoring.json'
  | 'broken-links.json'
  | 'core-web-vitals.json'
  | 'lighthouse-summary.json'
  | 'memory-profile.json'
  | 'network-recommendations.json'
  | 'network-requests.json'
  | 'performance.json'
  | 'security-scan.json'
  | 'seo-checks.json'
  | 'stability.json'
  | 'target-summary.json'
  | 'third-party-risk.json'
  | 'throttled-run.json'
  | 'visual-regression.json'
  | 'visual-current.png';

export const SECTION_FILES: SectionFile[] = [
  'a11y-beyond-axe.json',
  'accessibility.json',
  'api-monitoring.json',
  'broken-links.json',
  'core-web-vitals.json',
  'lighthouse-summary.json',
  'memory-profile.json',
  'network-recommendations.json',
  'network-requests.json',
  'performance.json',
  'security-scan.json',
  'seo-checks.json',
  'stability.json',
  'target-summary.json',
  'third-party-risk.json',
  'throttled-run.json',
  'visual-current.png',
  'visual-regression.json'
];

export interface ValidationEntry { scope: 'global' | 'url'; id: string; found: string[]; missing: string[] }

export interface UrlModel {
  id: string;
  url: string;
  artifacts: Record<string, unknown>;
  images: Record<string, string>;
  categoryScores: Record<string, { value: number; derived: boolean }>;
  overallScore: number;
  grade: string;
  status: 'PASS' | 'WARN' | 'FAIL';
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

export interface SectionIndexStatus {
  file: SectionFile;
  exists: boolean;
  state: 'missing' | 'not_available' | 'ok' | 'issues' | 'error';
  summary: Record<string, unknown>;
}

export interface UrlIndexEntry {
  id: string;
  folderName: string;
  url: string;
  runId: string | null;
  timestamp: string | null;
  hasFailures: boolean;
  badges: Record<'a11y' | 'perf' | 'net' | 'sec' | 'seo' | 'visual' | 'stability', 'missing' | 'ok' | 'issues'>;
  sections: Record<SectionFile, SectionIndexStatus>;
}

export interface DashboardIndex {
  runPath: string;
  urls: UrlIndexEntry[];
  parseErrors: Array<{ file: string; message: string }>;
  generatedAt: string;
}

class LruCache<K, V> {
  private map = new Map<K, V>();
  constructor(private readonly maxSize: number) {}

  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value === undefined) return undefined;
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.maxSize) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }
}

export class ArtifactStore {
  private readonly cache = new LruCache<string, unknown>(200);
  readonly parseErrors: Array<{ file: string; message: string }> = [];

  constructor(private readonly runPath: string) {}

  private async readJson(filePath: string): Promise<{ ok: boolean; data?: JsonValue; error?: string }> {
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw) as JsonValue;
      return { ok: true, data: parsed };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.parseErrors.push({ file: path.relative(this.runPath, filePath), message });
      return { ok: false, error: message };
    }
  }

  async loadSection(urlId: string, section: SectionFile): Promise<{ state: SectionIndexStatus['state']; raw: unknown; summary: Record<string, unknown>; error?: string }> {
    const filePath = path.join(this.runPath, urlId, section);
    if (section === 'visual-current.png') {
      try {
        await fs.access(filePath);
        return { state: 'ok', raw: null, summary: { image: `/artifacts/${encodeURIComponent(urlId)}/${encodeURIComponent(section)}` } };
      } catch {
        return { state: 'missing', raw: null, summary: {} };
      }
    }

    const cached = this.cache.get(filePath);
    const data = cached ?? (await this.readJson(filePath)).data;
    if (data === undefined) {
      try {
        await fs.access(filePath);
        return { state: 'error', raw: null, summary: {}, error: this.parseErrors.at(-1)?.message ?? 'Malformed JSON' };
      } catch {
        return { state: 'missing', raw: null, summary: {} };
      }
    }
    this.cache.set(filePath, data);
    return normalizeSection(section, data);
  }
}

const toNum = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

const severityList = ['critical', 'serious', 'moderate', 'minor'] as const;


function unwrapRaw(raw: unknown): { payload: unknown; meta: Record<string, unknown> } {
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw) && 'payload' in raw) {
    const wrapped = raw as { payload: unknown; meta?: unknown };
    return { payload: wrapped.payload, meta: (typeof wrapped.meta === 'object' && wrapped.meta !== null ? wrapped.meta : {}) as Record<string, unknown> };
  }
  return { payload: raw, meta: {} };
}

function normalizeSection(section: SectionFile, raw: unknown): { state: SectionIndexStatus['state']; raw: unknown; summary: Record<string, unknown> } {
  const unwrapped = unwrapRaw(raw);
  const obj = (typeof unwrapped.payload === 'object' && unwrapped.payload !== null ? unwrapped.payload : {}) as Record<string, unknown>;
  if (obj.available === false) return { state: 'not_available', raw, summary: { reason: obj.reason ?? obj.message ?? 'Not available' } };

  if (section === 'accessibility.json') {
    const counters = (obj.counters as Record<string, unknown> | undefined) ?? obj;
    const severities = Object.fromEntries(severityList.map((s) => [s, toNum(counters[s]) ?? 0]));
    const total = severityList.reduce((sum, s) => sum + (severities[s] as number), 0);
    return { state: total > 0 ? 'issues' : 'ok', raw, summary: { ...severities, total } };
  }
  if (section === 'broken-links.json') {
    const broken = toNum(obj.brokenCount ?? obj.broken) ?? 0;
    return { state: broken > 0 ? 'issues' : 'ok', raw, summary: { brokenCount: broken } };
  }
  if (section === 'visual-regression.json') {
    const passed = obj.passed === true;
    const baselineFound = obj.baselineFound !== false;
    return { state: !baselineFound || !passed ? 'issues' : 'ok', raw, summary: { passed, baselineFound, diffRatio: toNum(obj.diffRatio ?? obj.diffScore) } };
  }
  if (section === 'security-scan.json') {
    const missingHeaders = Array.isArray(obj.missingHeaders) ? obj.missingHeaders.length : 0;
    return { state: missingHeaders > 0 ? 'issues' : 'ok', raw, summary: { missingHeaders } };
  }
  if (section === 'network-recommendations.json') {
    const list = Array.isArray(unwrapped.payload) ? unwrapped.payload as Record<string, unknown>[] : Array.isArray(obj.recommendations) ? obj.recommendations as Record<string, unknown>[] : [];
    const high = list.filter((x) => String(x.severity ?? '').toLowerCase() === 'high').length;
    return { state: list.length > 0 ? 'issues' : 'ok', raw, summary: { count: list.length, high } };
  }
  if (section === 'stability.json') {
    const unstable = obj.unstable === true;
    return { state: unstable ? 'issues' : 'ok', raw, summary: { unstable } };
  }
  if (section === 'lighthouse-summary.json') {
    if (obj.available === false) return { state: 'not_available', raw, summary: { reason: obj.reason ?? 'Not available' } };
    return { state: 'ok', raw, summary: { performance: toNum(obj.performance), accessibility: toNum(obj.accessibility), seo: toNum(obj.seo) } };
  }

  const issueHint = toNum(obj.issueCount ?? obj.errors ?? obj.failures ?? obj.failed ?? obj.regressions ?? obj.riskCount);
  if (issueHint !== null) return { state: issueHint > 0 ? 'issues' : 'ok', raw, summary: { issueCount: issueHint } };
  return { state: 'ok', raw, summary: {} };
}

function deriveUrl(folderName: string, targetSummary?: Record<string, unknown>, meta?: Record<string, unknown>): string {
  return String(targetSummary?.url ?? (targetSummary?.target as Record<string, unknown> | undefined)?.url ?? meta?.url ?? folderName);
}

function grade(score: number): string {
  return score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F';
}

function aggregateBadge(...states: Array<'missing' | 'not_available' | 'ok' | 'issues' | 'error'>): 'missing' | 'ok' | 'issues' {
  if (states.some((s) => s === 'issues' || s === 'error')) return 'issues';
  if (states.every((s) => s === 'missing' || s === 'not_available')) return 'missing';
  return 'ok';
}

export async function buildDashboardIndex(runPath: string): Promise<{ index: DashboardIndex; store: ArtifactStore }> {
  const store = new ArtifactStore(runPath);
  const entries = await fs.readdir(runPath, { withFileTypes: true });
  const urlDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort((a, b) => a.localeCompare(b));
  const urls: UrlIndexEntry[] = [];

  for (const id of urlDirs) {
    const sections = {} as Record<SectionFile, SectionIndexStatus>;
    for (const section of SECTION_FILES) {
      const loaded = await store.loadSection(id, section);
      sections[section] = { file: section, exists: loaded.state !== 'missing', state: loaded.state, summary: loaded.summary };
    }
    const targetLoaded = await store.loadSection(id, 'target-summary.json');
    const targetUnwrapped = unwrapRaw(targetLoaded.raw);
    const targetRaw = (targetUnwrapped.payload && typeof targetUnwrapped.payload === 'object') ? targetUnwrapped.payload as Record<string, unknown> : undefined;
    const url = deriveUrl(id, targetRaw, targetUnwrapped.meta);

    const a11ySev = sections['accessibility.json'].summary;
    const hasFailures = Object.values(sections).some((s) => s.state === 'issues' || s.state === 'error');
    urls.push({
      id,
      folderName: id,
      url,
      runId: (targetRaw?.runId ?? targetUnwrapped.meta.runId) ? String(targetRaw?.runId ?? targetUnwrapped.meta.runId) : null,
      timestamp: (targetRaw?.timestamp ?? targetUnwrapped.meta.timestamp) ? String(targetRaw?.timestamp ?? targetUnwrapped.meta.timestamp) : null,
      hasFailures,
      badges: {
        a11y: aggregateBadge(sections['accessibility.json'].state, sections['a11y-beyond-axe.json'].state),
        perf: aggregateBadge(sections['performance.json'].state, sections['core-web-vitals.json'].state, sections['lighthouse-summary.json'].state),
        net: aggregateBadge(sections['network-requests.json'].state, sections['network-recommendations.json'].state, sections['api-monitoring.json'].state),
        sec: aggregateBadge(sections['security-scan.json'].state, sections['third-party-risk.json'].state),
        seo: aggregateBadge(sections['seo-checks.json'].state),
        visual: aggregateBadge(sections['visual-regression.json'].state, sections['visual-current.png'].state),
        stability: aggregateBadge(sections['stability.json'].state, sections['broken-links.json'].state)
      },
      sections
    });

    // Preserve key counter hints for facets
    urls[urls.length - 1].sections['accessibility.json'].summary = { ...a11ySev };
  }

  return {
    index: { runPath, urls, parseErrors: store.parseErrors, generatedAt: new Date().toISOString() },
    store
  };
}

// Backward compatibility for current tests
export async function loadDashboardRun(runPath: string): Promise<DashboardRunData> {
  const { index, store } = await buildDashboardIndex(runPath);
  const urls: UrlModel[] = [];
  for (const item of index.urls) {
    const artifacts: Record<string, unknown> = {};
    const images: Record<string, string> = {};
    for (const section of SECTION_FILES) {
      const loaded = await store.loadSection(item.id, section);
      if (section === 'visual-current.png') {
        if (loaded.state !== 'missing') images[section] = String(loaded.summary.image ?? '');
      } else if (loaded.state !== 'missing' && loaded.state !== 'error') {
        artifacts[section] = unwrapRaw(loaded.raw).payload;
      }
    }

    const a11y = (artifacts['accessibility.json'] as Record<string, unknown> | undefined) ?? {};
    const performance = (artifacts['lighthouse-summary.json'] as Record<string, unknown> | undefined) ?? {};
    const perfScore = toNum(performance.performance);
    const a11yScore = toNum(performance.accessibility);
    const seoScore = toNum(performance.seo);
    const overall = Math.round(((perfScore ?? 60) + (a11yScore ?? 70) + (seoScore ?? 70)) / 3);
    const status: 'PASS' | 'WARN' | 'FAIL' = item.hasFailures ? (overall < 60 ? 'FAIL' : 'WARN') : 'PASS';

    urls.push({
      id: item.id,
      url: item.url,
      artifacts,
      images,
      categoryScores: {
        performance: { value: perfScore ?? overall, derived: perfScore === null },
        accessibility: { value: a11yScore ?? (100 - ((toNum(a11y.critical) ?? 0) * 10)), derived: a11yScore === null },
        security: { value: 70, derived: true },
        stability: { value: 70, derived: true },
        seo: { value: seoScore ?? 70, derived: seoScore === null },
        visual: { value: 70, derived: true }
      },
      overallScore: overall,
      grade: grade(overall),
      status,
      blockers: [],
      regressions: toNum((artifacts['visual-regression.json'] as Record<string, unknown> | undefined)?.regressions) ?? 0,
      environment: 'Not available',
      lastRunAt: item.timestamp ?? 'Not available',
      hasThrottled: item.sections['throttled-run.json'].state !== 'missing'
    });
  }

  return {
    runPath,
    globalArtifacts: {},
    urls,
    validation: index.urls.map((u) => ({ scope: 'url' as const, id: u.id, found: SECTION_FILES.filter((f) => u.sections[f].exists), missing: SECTION_FILES.filter((f) => !u.sections[f].exists) }))
  };
}

export interface OverviewRow { folderName: string; url: string; critical: number; serious: number; moderate: number; minor: number; ttfbMs: number; dclMs: number; loadEventMs: number; totalTransferSize: number; resourceCount: number; requestCount: number; failedRequestCount: number; networkTransferSize: number; slowestRequestMs: number; recommendationCounts: Record<string, number>; accessibilityIssues: unknown[]; networkRequests: Record<string, unknown>[]; networkRecommendations: Record<string, unknown>[] }
export interface RunSummaryMetrics { totalPages: number; accessibilityTotals: { critical: number; serious: number; moderate: number; minor: number }; worstByLoadEventMs: OverviewRow[]; worstByCriticalIssues: OverviewRow[]; worstByTransferSize: OverviewRow[] }

export function toOverviewRows(data: DashboardRunData): OverviewRow[] {
  return data.urls.map((u) => {
    const a11y = (u.artifacts['accessibility.json'] as Record<string, unknown> | undefined) ?? {};
    const perf = (u.artifacts['performance.json'] as Record<string, unknown> | undefined) ?? {};
    const navigation = (perf.navigation as Record<string, unknown> | undefined) ?? {};
    const resourceSummary = (perf.resourceSummary as Record<string, unknown> | undefined) ?? {};
    const requests = (Array.isArray(u.artifacts['network-requests.json']) ? u.artifacts['network-requests.json'] : []) as Record<string, unknown>[];
    const recs = (Array.isArray(u.artifacts['network-recommendations.json']) ? u.artifacts['network-recommendations.json'] : []) as Record<string, unknown>[];
    const counters = (a11y.counters as Record<string, unknown> | undefined) ?? a11y;
    return {
      folderName: u.id,
      url: u.url,
      critical: toNum(counters.critical) ?? 0,
      serious: toNum(counters.serious) ?? 0,
      moderate: toNum(counters.moderate) ?? 0,
      minor: toNum(counters.minor) ?? 0,
      ttfbMs: toNum(navigation.ttfbMs) ?? 0,
      dclMs: toNum(navigation.domContentLoadedMs) ?? 0,
      loadEventMs: toNum(navigation.loadEventMs) ?? 0,
      totalTransferSize: toNum(resourceSummary.transferSize) ?? 0,
      resourceCount: toNum(resourceSummary.count) ?? 0,
      requestCount: requests.length,
      failedRequestCount: requests.filter((r) => (toNum(r.status) ?? 200) >= 400).length,
      networkTransferSize: requests.reduce((acc, r) => acc + (toNum(r.transferSize) ?? 0), 0),
      slowestRequestMs: requests.reduce((acc, r) => Math.max(acc, toNum(r.durationMs ?? r.duration) ?? 0), 0),
      recommendationCounts: recs.reduce<Record<string, number>>((acc, rec) => {
        const sev = String(rec.severity ?? 'unknown');
        acc[sev] = (acc[sev] ?? 0) + 1;
        return acc;
      }, {}),
      accessibilityIssues: Array.isArray(a11y.issues) ? a11y.issues : [],
      networkRequests: requests,
      networkRecommendations: recs
    };
  });
}

function worst(rows: readonly OverviewRow[], metric: (row: OverviewRow) => number): OverviewRow[] {
  return [...rows].sort((a, b) => metric(b) - metric(a) || a.url.localeCompare(b.url)).slice(0, 5);
}

export function computeRunSummary(rows: readonly OverviewRow[]): RunSummaryMetrics {
  const accessibilityTotals = rows.reduce(
    (acc, row) => ({
      critical: acc.critical + row.critical,
      serious: acc.serious + row.serious,
      moderate: acc.moderate + row.moderate,
      minor: acc.minor + row.minor
    }),
    { critical: 0, serious: 0, moderate: 0, minor: 0 }
  );
  return {
    totalPages: rows.length,
    accessibilityTotals,
    worstByLoadEventMs: worst(rows, (r) => r.loadEventMs),
    worstByCriticalIssues: worst(rows, (r) => r.critical),
    worstByTransferSize: worst(rows, (r) => r.totalTransferSize)
  };
}
