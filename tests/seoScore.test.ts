import { describe, expect, it } from 'vitest';
import { computeSeoScore } from '../src/collectors/seoScore/computeSeoScore.js';
import type { SeoScoreInput } from '../src/collectors/seoScore/types.js';

const baseInput: SeoScoreInput = {
  url: 'https://example.com/',
  generatedAt: '2026-01-01T00:00:00.000Z',
  statusCode: 200,
  redirectChainLength: 0,
  responseHeaders: {},
  metaRobots: 'index,follow',
  robotsTxtAllows: true,
  canonicalUrl: 'https://example.com/',
  title: 'Example title for SEO checks',
  description: 'This is an example description with enough length for deterministic scoring checks.',
  h1Count: 1,
  ogTitle: 'Example OG Title',
  ogDescription: 'Example OG Description',
  imageCount: 10,
  imagesWithAltCount: 9,
  textWordCount: 350,
  hasSoft404Signals: false,
  brokenInternalLinksCount: 0,
  duplicateMetadataSignal: false,
  webVitals: { lcp: 1500, cls: 0.05, inp: 120 },
  pageWeightBytes: 500000,
  requestCount: 25
};

describe('computeSeoScore', () => {
  it('is deterministic for a fixed input', () => {
    const a = computeSeoScore(baseInput);
    const b = computeSeoScore(baseInput);
    expect(a).toEqual(b);
  });

  it('re-normalizes when a whole category is not measured', () => {
    const result = computeSeoScore({ ...baseInput, webVitals: { lcp: null, cls: null, inp: null }, pageWeightBytes: null, requestCount: null });
    expect(result.subscores.performanceProxy.measuredWeight).toBe(0);
    expect(result.overallScore).toBe(100);
  });

  it('applies title boundary thresholds', () => {
    const minPass = computeSeoScore({ ...baseInput, title: 'a'.repeat(15) });
    const below = computeSeoScore({ ...baseInput, title: 'a'.repeat(14) });
    const passCheck = minPass.checks.find((check) => check.id === 'meta.title.length');
    const failCheck = below.checks.find((check) => check.id === 'meta.title.length');
    expect(passCheck?.status).toBe('pass');
    expect(failCheck?.status).toBe('fail');
  });
});
