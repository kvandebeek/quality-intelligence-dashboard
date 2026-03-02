import type { SeoScoreCategory } from './types.js';

export const SEO_SCORE_VERSION = 'seo-score-v1' as const;

export const CATEGORY_WEIGHTS: Record<SeoScoreCategory, number> = {
  indexability: 0.3,
  onPage: 0.3,
  content: 0.2,
  performanceProxy: 0.2
};

export const CATEGORY_MAX_POINTS: Record<SeoScoreCategory, number> = {
  indexability: 30,
  onPage: 30,
  content: 20,
  performanceProxy: 20
};

export const SCORE_LABELS = [
  { min: 90, label: 'Excellent' },
  { min: 75, label: 'Good' },
  { min: 55, label: 'Needs work' },
  { min: 0, label: 'Poor' }
] as const;

export const THRESHOLDS = {
  title: { min: 15, max: 60 },
  description: { min: 50, max: 160 },
  h1: { min: 1, max: 2 },
  imageAltCoverageMin: 0.8,
  minWords: 200,
  webVitals: { lcpGoodMs: 2500, clsGood: 0.1, inpGoodMs: 200 },
  pageWeightMaxBytes: 2_000_000,
  requestCountMax: 80
} as const;

export const CHECK_POINTS = {
  robotsIndexable: 10,
  robotsTxtAllowed: 6,
  canonicalValid: 6,
  httpStatusAndSoft404: 8,
  titleLength: 8,
  descriptionLength: 6,
  h1Count: 6,
  openGraphTags: 4,
  imageAltCoverage: 6,
  brokenInternalLinks: 8,
  duplicateMetadata: 6,
  thinContent: 6,
  coreWebVitalsProxy: 12,
  pageWeightAndRequestCount: 8
} as const;

export const CHECK_IDS = {
  robotsIndexable: 'indexability.robots.indexable',
  robotsTxtAllowed: 'indexability.robots-txt.allowed',
  canonicalValid: 'indexability.canonical.valid',
  httpStatusAndSoft404: 'indexability.http.status-soft404',
  titleLength: 'meta.title.length',
  descriptionLength: 'meta.description.length',
  h1Count: 'semantics.h1.count',
  openGraphTags: 'meta.opengraph.present',
  imageAltCoverage: 'media.image.alt-coverage',
  brokenInternalLinks: 'links.internal.broken',
  duplicateMetadata: 'content.duplicates.metadata',
  thinContent: 'content.thin.word-count',
  coreWebVitalsProxy: 'performance.web-vitals.proxy',
  pageWeightAndRequestCount: 'performance.page-weight-requests.proxy'
} as const;
