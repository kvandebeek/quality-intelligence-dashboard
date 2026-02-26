export type Severity = 'critical' | 'serious' | 'moderate' | 'minor' | 'unknown';

export interface RunTarget {
  name: string;
  url: string;
  waitForSelector?: string;
}

export interface RunMetadata {
  runId: string;
  timestamp: string;
  browser: 'chromium' | 'firefox' | 'webkit';
  environment: string;
  iteration: number;
  targets: RunTarget[];
}

export interface PerformanceMetrics {
  url: string;
  navigation: Record<string, number>;
  paint: Record<string, number>;
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
  }>;
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
  browser: 'chromium' | 'firefox' | 'webkit';
  headless: boolean;
  environment: string;
  iteration: number;
  outputDir: string;
  targets: RunTarget[];
  elasticsearch: ElasticConfig;
}
