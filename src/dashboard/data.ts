import fs from 'node:fs/promises';
import path from 'node:path';
import {
  accessibilitySchema,
  networkRecommendationsSchema,
  networkRequestsSchema,
  performanceSchema,
  targetSummarySchema,
  type AccessibilityIssue,
  type AccessibilityReport,
  type NetworkRecommendation,
  type NetworkRequest,
  type PerformanceReport,
  type TargetSummary
} from './schemas.js';

export interface DashboardPageData {
  folderName: string;
  hasHar: boolean;
  targetSummary: TargetSummary;
  performance: PerformanceReport;
  accessibility: AccessibilityReport;
  networkRequests: NetworkRequest[];
  networkRecommendations: NetworkRecommendation[];
}

export interface DashboardRunData {
  runPath: string;
  pages: DashboardPageData[];
}

export interface RunPathOptions {
  cliRunPath?: string;
  envRunPath?: string;
}

export function resolveRunPath(options: RunPathOptions): string {
  const value = options.cliRunPath ?? options.envRunPath;
  if (!value) {
    throw new Error('Missing run folder path. Provide --run <path> or ARTIFACT_RUN_DIR.');
  }
  return path.resolve(value);
}

function stableSort<T>(items: readonly T[], getKey: (item: T) => string): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const keyCompare = getKey(left.item).localeCompare(getKey(right.item));
      return keyCompare !== 0 ? keyCompare : left.index - right.index;
    })
    .map((entry) => entry.item);
}

async function parseJsonFile<T>(filePath: string, parser: { parse: (input: unknown) => T }, label: string): Promise<T> {
  try {
    const text = await fs.readFile(filePath, 'utf8');
    const json = JSON.parse(text) as unknown;
    return parser.parse(json);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid ${label} at ${filePath}: ${message}`);
  }
}

export async function loadDashboardRun(runPath: string): Promise<DashboardRunData> {
  const entries = await fs.readdir(runPath, { withFileTypes: true });
  const pageFolders = stableSort(
    entries.filter((entry) => entry.isDirectory() && entry.name.startsWith('page-')).map((entry) => entry.name),
    (name) => name
  );

  const pages: DashboardPageData[] = [];
  for (const folderName of pageFolders) {
    const pageRoot = path.join(runPath, folderName);
    const targetSummary = await parseJsonFile(path.join(pageRoot, 'target-summary.json'), targetSummarySchema, 'target-summary.json');
    const performance = await parseJsonFile(path.join(pageRoot, 'performance.json'), performanceSchema, 'performance.json');
    const accessibility = await parseJsonFile(path.join(pageRoot, 'accessibility.json'), accessibilitySchema, 'accessibility.json');
    const networkRequests = await parseJsonFile(path.join(pageRoot, 'network-requests.json'), networkRequestsSchema, 'network-requests.json');
    const networkRecommendations = await parseJsonFile(
      path.join(pageRoot, 'network-recommendations.json'),
      networkRecommendationsSchema,
      'network-recommendations.json'
    );

    let hasHar = false;
    try {
      await fs.access(path.join(pageRoot, 'network.har'));
      hasHar = true;
    } catch {
      hasHar = false;
    }

    pages.push({
      folderName,
      hasHar,
      targetSummary,
      performance,
      accessibility,
      networkRequests,
      networkRecommendations
    });
  }

  return { runPath, pages };
}

export interface OverviewRow {
  folderName: string;
  url: string;
  critical: number;
  serious: number;
  moderate: number;
  minor: number;
  ttfbMs: number;
  dclMs: number;
  loadEventMs: number;
  totalTransferSize: number;
  resourceCount: number;
  requestCount: number;
  failedRequestCount: number;
  networkTransferSize: number;
  slowestRequestMs: number;
  recommendationCounts: Record<string, number>;
  accessibilityIssues: AccessibilityIssue[];
  networkRequests: NetworkRequest[];
  networkRecommendations: NetworkRecommendation[];
}

export interface RunSummaryMetrics {
  totalPages: number;
  accessibilityTotals: {
    critical: number;
    serious: number;
    moderate: number;
    minor: number;
  };
  worstByLoadEventMs: OverviewRow[];
  worstByCriticalIssues: OverviewRow[];
  worstByTransferSize: OverviewRow[];
}

function getCounter(report: AccessibilityReport, key: string): number {
  return report.counters[key] ?? 0;
}

function recommendationBuckets(recommendations: readonly NetworkRecommendation[]): Record<string, number> {
  const preferredOrder = ['high', 'medium', 'low'];
  const grouped: Record<string, number> = {};
  for (const recommendation of recommendations) {
    grouped[recommendation.severity] = (grouped[recommendation.severity] ?? 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(grouped).sort((left, right) => {
      const leftRank = preferredOrder.indexOf(left[0]);
      const rightRank = preferredOrder.indexOf(right[0]);
      const normalizedLeftRank = leftRank === -1 ? Number.MAX_SAFE_INTEGER : leftRank;
      const normalizedRightRank = rightRank === -1 ? Number.MAX_SAFE_INTEGER : rightRank;
      if (normalizedLeftRank !== normalizedRightRank) {
        return normalizedLeftRank - normalizedRightRank;
      }
      return left[0].localeCompare(right[0]);
    })
  );
}

export function toOverviewRows(data: DashboardRunData): OverviewRow[] {
  return stableSort(
    data.pages.map((page) => {
      const failedRequestCount = page.networkRequests.filter((request) => request.status < 200 || request.status >= 400).length;
      const networkTransferSize = page.networkRequests.reduce((total, request) => total + request.transferSize, 0);
      const slowestRequestMs = page.networkRequests.reduce((max, request) => Math.max(max, request.durationMs), 0);
      return {
        folderName: page.folderName,
        url: page.targetSummary.target.url,
        critical: getCounter(page.accessibility, 'critical'),
        serious: getCounter(page.accessibility, 'serious'),
        moderate: getCounter(page.accessibility, 'moderate'),
        minor: getCounter(page.accessibility, 'minor'),
        ttfbMs: page.performance.navigation.responseStart ?? 0,
        dclMs: page.performance.navigation.domContentLoadedEventEnd ?? 0,
        loadEventMs: page.performance.navigation.loadEventEnd ?? 0,
        totalTransferSize: page.performance.resourceSummary.transferSize,
        resourceCount: page.performance.resourceSummary.count,
        requestCount: page.networkRequests.length,
        failedRequestCount,
        networkTransferSize,
        slowestRequestMs,
        recommendationCounts: recommendationBuckets(page.networkRecommendations),
        accessibilityIssues: page.accessibility.issues,
        networkRequests: page.networkRequests,
        networkRecommendations: page.networkRecommendations
      } satisfies OverviewRow;
    }),
    (row) => row.url
  );
}

function selectWorst(rows: readonly OverviewRow[], metric: (row: OverviewRow) => number): OverviewRow[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const metricDelta = metric(right.row) - metric(left.row);
      if (metricDelta !== 0) {
        return metricDelta;
      }
      const urlCompare = left.row.url.localeCompare(right.row.url);
      if (urlCompare !== 0) {
        return urlCompare;
      }
      return left.index - right.index;
    })
    .slice(0, 5)
    .map((entry) => entry.row);
}

export function computeRunSummary(rows: readonly OverviewRow[]): RunSummaryMetrics {
  const accessibilityTotals = rows.reduce(
    (totals, row) => ({
      critical: totals.critical + row.critical,
      serious: totals.serious + row.serious,
      moderate: totals.moderate + row.moderate,
      minor: totals.minor + row.minor
    }),
    { critical: 0, serious: 0, moderate: 0, minor: 0 }
  );

  return {
    totalPages: rows.length,
    accessibilityTotals,
    worstByLoadEventMs: selectWorst(rows, (row) => row.loadEventMs),
    worstByCriticalIssues: selectWorst(rows, (row) => row.critical),
    worstByTransferSize: selectWorst(rows, (row) => row.totalTransferSize)
  };
}
