export type Severity = 'critical' | 'serious' | 'moderate' | 'minor' | 'unknown';
export type BrowserName = 'chromium' | 'firefox' | 'webkit';
export type CrawlSkipReason =
  | 'duplicate_url'
  | 'disallowed_domain'
  | 'excluded_resource_type'
  | 'invalid_url'
  | 'depth_exceeded'
  | 'max_pages_exceeded';

export interface RunTarget {
  name: string;
  url: string;
  waitForSelector?: string;
}

export interface CrawlConfig {
  enabled: boolean;
  maxDepth: number;
  maxPages: number;
  includeExternalDomains: boolean;
  allowedDomains: string[];
}

export interface CrawlPageMetadata {
  url: string;
  parentUrl: string | null;
  depth: number;
}

export interface CrawlSkipRecord {
  url: string;
  parentUrl: string | null;
  depth: number;
  reason: CrawlSkipReason;
}

export interface CrawlSummaryMetadata {
  totalPagesDiscovered: number;
  totalPagesExecuted: number;
  pages: CrawlPageMetadata[];
  skippedUrls: CrawlSkipRecord[];
}

export interface RunMetadata {
  runId: string;
  timestamp: string;
  browser: BrowserName;
  environment: string;
  iteration: number;
  name?: string;
  startUrl: string;
  targets: RunTarget[];
}

export interface PerformanceMetrics {
  url: string;
  navigation: Record<string, number>;
  paint: Record<string, number | null>;
  resourceSummary: {
    count: number;
    transferSize: number;
    encodedBodySize: number;
    decodedBodySize: number;
  };
}

export interface NetworkRequestRecord {
  url: string;
  method: string;
  status: number;
  resourceType: string;
  transferSize: number;
  durationMs: number;
  fromCache: boolean;
}

export interface NetworkRecommendation {
  id: string;
  title: string;
  description: string;
  severity: 'high' | 'medium' | 'low';
  impactedCount: number;
}

export interface AccessibilityIssue {
  id: string;
  impact: Severity;
  description: string;
  help: string;
  nodes: number;
  tags: string[];
  recommendation: string;
}

export interface AccessibilityReport {
  url: string;
  issues: AccessibilityIssue[];
  counters: Record<Severity, number>;
}

export interface TargetRunArtifacts {
  target: RunTarget;
  performance: PerformanceMetrics;
  network: {
    harPath: string;
    requests: NetworkRequestRecord[];
    recommendations: NetworkRecommendation[];
  };
  accessibility: AccessibilityReport;
}

export const CROSS_BROWSER_PERFORMANCE_CATEGORY = 'cross-browser-performance' as const;
export const CROSS_BROWSER_PERFORMANCE_FILE = 'cross-browser-performance.json' as const;
export const CROSS_BROWSER_PERFORMANCE_WAIT_UNTIL = 'load' as const;
export const CROSS_BROWSER_RUNS_PER_BROWSER = 5 as const;

export interface CrossBrowserIterationTiming {
  iteration: number;
  loadDurationMs: number | null;
  domContentLoadedMs: number | null;
  loadEventEndMs: number | null;
  responseStartMs: number | null;
  requestStartMs: number | null;
}

export interface CrossBrowserPerformanceBrowserResult {
  iterations: CrossBrowserIterationTiming[];
  avgLoadDurationMs: number | null;
  minLoadDurationMs: number | null;
  maxLoadDurationMs: number | null;
  error?: string;
}

export interface CrossBrowserPerformanceReport {
  meta: {
    url: string;
    runsPerBrowser: number;
    waitUntil: 'load';
    timestamp: string;
  };
  browsers: Record<BrowserName, CrossBrowserPerformanceBrowserResult>;
  comparison: {
    fastest: BrowserName | null;
    slowest: BrowserName | null;
    diffMsSlowestVsFastest: number | null;
  };
}

export interface RunSummary {
  metadata: RunMetadata;
  outputs: Array<{
    targetName: string;
    folder: string;
    files: string[];
    crawl?: CrawlPageMetadata;
  }>;
  crawl?: CrawlSummaryMetadata;
}

export interface ElasticConfig {
  enabled: boolean;
  node?: string;
  apiKey?: string;
  username?: string;
  password?: string;
  indexPrefix?: string;
}



export interface AssuranceModulesConfig {
  enabled: {
    clientErrors: boolean;
    uxFriction: boolean;
    memoryLeaks: boolean;
    cacheAnalysis: boolean;
    thirdPartyResilience: boolean;
    privacyAudit: boolean;
    runtimeSecurity: boolean;
    dependencyRisk: boolean;
    regressionDelta: boolean;
    uxSuite: boolean;
  };
  clientErrors: {
    topErrorsLimit: number;
    ignoreMessages: string[];
  };
  ux: {
    rageClickWindowMs: number;
    rageClickThreshold: number;
    deadClickWindowMs: number;
  };
  memory: {
    interactionLoops: number;
    growthThresholdMB: number;
  };
  cache: {
    minStaticTtlSeconds: number;
  };
  thirdPartyResilience: {
    mode: 'trackers-only' | 'all-third-party';
    defaultBlocklist: string[];
  };
  privacy: {
    consentSelectors: string[];
    mode: 'pre-consent' | 'post-consent';
    trackerDomains: string[];
  };
  dependencyRisk: {
    categoryRules: Record<string, string>;
  };
  regression: {
    elevatedThreshold: number;
    watchThreshold: number;
  };
  uxSuite: {
    maxClickCandidates: number;
    maxTabSteps: number;
    observationWindowMs: number;
  };
}

export interface AppConfig {
  browser: BrowserName;
  headless: boolean;
  environment: string;
  iteration: number;
  outputDir: string;
  name?: string;
  startUrl: string;
  targets: RunTarget[];
  crawl: CrawlConfig;
  consent: {
    enabled: boolean;
    timeoutMs: number;
  };
  elasticsearch: ElasticConfig;
  assuranceModules: AssuranceModulesConfig;
}
