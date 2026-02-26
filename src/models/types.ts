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
  elasticsearch: ElasticConfig;
}
