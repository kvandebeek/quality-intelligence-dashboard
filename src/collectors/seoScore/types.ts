export type SeoScoreCategory = 'indexability' | 'onPage' | 'content' | 'performanceProxy';
export type SeoCheckStatus = 'pass' | 'warn' | 'fail' | 'not_measured';

export interface SeoScoreCheck {
  id: string;
  category: SeoScoreCategory;
  label: string;
  status: SeoCheckStatus;
  weight: number;
  points: number;
  maxPoints: number;
  details: Record<string, unknown>;
  recommendation: string;
}

export interface SeoCategoryScore {
  score: number;
  measuredWeight: number;
  checks: SeoScoreCheck[];
}

export interface SeoScoreArtifact {
  version: 'seo-score-v1';
  url: string;
  generatedAt: string;
  overallScore: number;
  weights: Record<SeoScoreCategory, number>;
  subscores: Record<SeoScoreCategory, SeoCategoryScore>;
  checks: SeoScoreCheck[];
}

export interface SeoScoreInput {
  url: string;
  generatedAt: string;
  statusCode: number | null;
  redirectChainLength: number;
  responseHeaders: Record<string, string>;
  metaRobots: string | null;
  robotsTxtAllows: boolean | null;
  canonicalUrl: string | null;
  title: string | null;
  description: string | null;
  h1Count: number | null;
  ogTitle: string | null;
  ogDescription: string | null;
  imageCount: number | null;
  imagesWithAltCount: number | null;
  textWordCount: number | null;
  hasSoft404Signals: boolean;
  brokenInternalLinksCount: number | null;
  duplicateMetadataSignal: boolean | null;
  webVitals: { lcp: number | null; cls: number | null; inp: number | null };
  pageWeightBytes: number | null;
  requestCount: number | null;
}
