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
  fcpAttempts?: Array<{
    attempt: number;
    fcpMs: number | null;
    cleanStateRetry: boolean;
  }>;
  fcpReportedMs?: number | null;
  fcpDecisionReason?: string;
  fcpIssue?: boolean;
  resourceSummary: {
    count: number;
    transferSize: number;
    encodedBodySize: number;
    decodedBodySize: number;
  };
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
  accessibility: AccessibilityReport;
}

export const CROSS_BROWSER_PERFORMANCE_CATEGORY = 'cross-browser-performance' as const;
export const CROSS_BROWSER_PERFORMANCE_FILE = 'cross-browser-performance.json' as const;
export const CROSS_BROWSER_PERFORMANCE_WAIT_UNTIL = 'load' as const;
export const CROSS_BROWSER_DEFAULT_RUNS = 5 as const;
export const CROSS_BROWSER_DEFAULT_BROWSERS: readonly BrowserName[] = ['chromium', 'firefox', 'webkit'] as const;

export type CrossBrowserConfigSource = 'file' | 'missing' | 'invalid';
export type CrossBrowserUntestedReason = 'disabled' | 'missing_config' | 'invalid_config' | 'skipped_headless' | 'no_browsers_configured';

export interface CrossBrowserConfig {
  enabled: boolean;
  browsers: readonly BrowserName[];
  runs: number;
  navigationTimeoutMs?: number;
  cooldownMs?: number;
  skipIfHeadless?: boolean;
}

export interface LoadedCrossBrowserConfig {
  source: CrossBrowserConfigSource;
  config: CrossBrowserConfig;
}

export interface CrossBrowserPerformanceBrowserResult {
  browser: BrowserName;
  avgLoadMs: number;
  minLoadMs: number;
  maxLoadMs: number;
  samples: number;
}

export interface CrossBrowserPerformanceReport {
  category: 'performance';
  crossBrowserPerformance: {
    status: 'tested' | 'untested';
    reason: CrossBrowserUntestedReason | null;
    config: {
      enabled: boolean;
      browsers: BrowserName[];
      runs: number;
    };
    results: CrossBrowserPerformanceBrowserResult[];
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
    memoryLeaks: boolean;
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
  memory: {
    interactionLoops: number;
    growthThresholdMB: number;
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
