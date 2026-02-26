export const CATEGORY_WEIGHTS = {
  performance: 0.3,
  accessibility: 0.2,
  security: 0.2,
  stability: 0.15,
  seo: 0.1,
  visual: 0.05
} as const;

export const SCORE_THRESHOLDS = {
  pass: 80,
  warn: 60,
  blockerCwvMultiplier: 1.35,
  blockerSecurityCritical: 1,
  blockerConsoleErrors: 20,
  blockerApiFailureRate: 0.25,
  regressionWarnCount: 1
} as const;

export const CWV_THRESHOLDS = {
  lcp: { good: 2500, poor: 4000 },
  cls: { good: 0.1, poor: 0.25 },
  inp: { good: 200, poor: 500 },
  ttfb: { good: 800, poor: 1800 }
} as const;

export const STATUS_VALUES = ['PASS', 'WARN', 'FAIL'] as const;
export type StatusValue = (typeof STATUS_VALUES)[number];
