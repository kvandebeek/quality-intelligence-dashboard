import { CATEGORY_MAX_POINTS, CATEGORY_WEIGHTS, CHECK_IDS, CHECK_POINTS, SEO_SCORE_VERSION, THRESHOLDS } from './seoScoreConstants.js';
import type { SeoCheckStatus, SeoScoreArtifact, SeoScoreCategory, SeoScoreCheck, SeoScoreInput } from './types.js';

function toStatus(pass: boolean): SeoCheckStatus {
  return pass ? 'pass' : 'fail';
}

function makeCheck(check: Omit<SeoScoreCheck, 'weight'>): SeoScoreCheck {
  const maxPoints = check.maxPoints;
  return {
    ...check,
    weight: maxPoints > 0 ? Number((check.points / maxPoints).toFixed(4)) : 0
  };
}

function isCanonicalValid(url: string, canonicalUrl: string | null): boolean {
  if (!canonicalUrl) return false;
  try {
    const resolved = new URL(canonicalUrl, url).toString();
    return resolved.length > 0;
  } catch {
    return false;
  }
}

function categoryFromCheck(check: SeoScoreCheck): SeoScoreCategory {
  return check.category;
}

export function computeSeoScore(input: SeoScoreInput): SeoScoreArtifact {
  const checks: SeoScoreCheck[] = [];
  const robotsCombined = `${input.metaRobots ?? ''} ${input.responseHeaders['x-robots-tag'] ?? ''}`.toLowerCase();
  const isIndexable = !robotsCombined.includes('noindex');

  checks.push(makeCheck({
    id: CHECK_IDS.robotsIndexable,
    category: 'indexability',
    label: 'Robots indexable (no noindex)',
    status: toStatus(isIndexable),
    points: isIndexable ? CHECK_POINTS.robotsIndexable : 0,
    maxPoints: CHECK_POINTS.robotsIndexable,
    details: { metaRobots: input.metaRobots, xRobotsTag: input.responseHeaders['x-robots-tag'] ?? null },
    recommendation: 'Remove noindex directives when the page should be indexed.'
  }));

  checks.push(makeCheck({
    id: CHECK_IDS.robotsTxtAllowed,
    category: 'indexability',
    label: 'Robots.txt allows crawling',
    status: input.robotsTxtAllows === null ? 'not_measured' : toStatus(input.robotsTxtAllows),
    points: input.robotsTxtAllows ? CHECK_POINTS.robotsTxtAllowed : 0,
    maxPoints: CHECK_POINTS.robotsTxtAllowed,
    details: { robotsTxtAllows: input.robotsTxtAllows },
    recommendation: 'Ensure robots.txt does not block important public pages.'
  }));

  const canonicalValid = isCanonicalValid(input.url, input.canonicalUrl);
  checks.push(makeCheck({
    id: CHECK_IDS.canonicalValid,
    category: 'indexability',
    label: 'Canonical tag present and valid',
    status: toStatus(canonicalValid),
    points: canonicalValid ? CHECK_POINTS.canonicalValid : 0,
    maxPoints: CHECK_POINTS.canonicalValid,
    details: { canonical: input.canonicalUrl },
    recommendation: 'Add a valid canonical URL for preferred indexing.'
  }));

  const statusOk = input.statusCode !== null && (input.statusCode === 200 || (input.statusCode >= 300 && input.statusCode < 400 && input.redirectChainLength > 0));
  const httpPass = statusOk && !input.hasSoft404Signals;
  checks.push(makeCheck({
    id: CHECK_IDS.httpStatusAndSoft404,
    category: 'indexability',
    label: 'HTTP status and soft-404 signals',
    status: input.statusCode === null ? 'not_measured' : toStatus(httpPass),
    points: httpPass ? CHECK_POINTS.httpStatusAndSoft404 : 0,
    maxPoints: CHECK_POINTS.httpStatusAndSoft404,
    details: { statusCode: input.statusCode, redirectChainLength: input.redirectChainLength, hasSoft404Signals: input.hasSoft404Signals },
    recommendation: 'Serve indexable pages with clean 200 responses and avoid soft-404 patterns.'
  }));

  const titleLength = input.title?.trim().length ?? 0;
  const titlePass = titleLength >= THRESHOLDS.title.min && titleLength <= THRESHOLDS.title.max;
  checks.push(makeCheck({ id: CHECK_IDS.titleLength, category: 'onPage', label: 'Title length', status: toStatus(titlePass), points: titlePass ? CHECK_POINTS.titleLength : 0, maxPoints: CHECK_POINTS.titleLength, details: { length: titleLength }, recommendation: 'Keep page titles unique and between 15-60 characters.' }));

  const descriptionLength = input.description?.trim().length ?? 0;
  const descriptionPass = descriptionLength >= THRESHOLDS.description.min && descriptionLength <= THRESHOLDS.description.max;
  checks.push(makeCheck({ id: CHECK_IDS.descriptionLength, category: 'onPage', label: 'Meta description length', status: toStatus(descriptionPass), points: descriptionPass ? CHECK_POINTS.descriptionLength : 0, maxPoints: CHECK_POINTS.descriptionLength, details: { length: descriptionLength }, recommendation: 'Write descriptive meta descriptions between 50-160 characters.' }));

  const h1Count = input.h1Count ?? 0;
  const h1Pass = h1Count >= THRESHOLDS.h1.min && h1Count <= THRESHOLDS.h1.max;
  checks.push(makeCheck({ id: CHECK_IDS.h1Count, category: 'onPage', label: 'H1 count', status: input.h1Count === null ? 'not_measured' : toStatus(h1Pass), points: h1Pass ? CHECK_POINTS.h1Count : 0, maxPoints: CHECK_POINTS.h1Count, details: { h1Count: input.h1Count }, recommendation: 'Use one clear H1 and avoid missing or excessive H1 tags.' }));

  const openGraphPass = Boolean(input.ogTitle?.trim()) && Boolean(input.ogDescription?.trim());
  checks.push(makeCheck({ id: CHECK_IDS.openGraphTags, category: 'onPage', label: 'Open Graph title/description', status: toStatus(openGraphPass), points: openGraphPass ? CHECK_POINTS.openGraphTags : 0, maxPoints: CHECK_POINTS.openGraphTags, details: { ogTitle: input.ogTitle, ogDescription: input.ogDescription }, recommendation: 'Provide og:title and og:description for richer sharing snippets.' }));

  const imageCoverage = input.imageCount && input.imageCount > 0 && input.imagesWithAltCount !== null ? input.imagesWithAltCount / input.imageCount : null;
  const imageCoveragePass = (imageCoverage ?? 0) >= THRESHOLDS.imageAltCoverageMin;
  checks.push(makeCheck({ id: CHECK_IDS.imageAltCoverage, category: 'onPage', label: 'Image alt text coverage', status: imageCoverage === null ? 'not_measured' : toStatus(imageCoveragePass), points: imageCoveragePass ? CHECK_POINTS.imageAltCoverage : 0, maxPoints: CHECK_POINTS.imageAltCoverage, details: { imageCount: input.imageCount, imagesWithAltCount: input.imagesWithAltCount, coverage: imageCoverage }, recommendation: 'Add meaningful alt text to non-decorative images.' }));

  const brokenLinksPass = input.brokenInternalLinksCount === 0;
  checks.push(makeCheck({ id: CHECK_IDS.brokenInternalLinks, category: 'content', label: 'Broken internal links', status: input.brokenInternalLinksCount === null ? 'not_measured' : toStatus(brokenLinksPass), points: brokenLinksPass ? CHECK_POINTS.brokenInternalLinks : 0, maxPoints: CHECK_POINTS.brokenInternalLinks, details: { brokenInternalLinksCount: input.brokenInternalLinksCount }, recommendation: 'Fix broken internal links and reduce redirect hops.' }));

  checks.push(makeCheck({ id: CHECK_IDS.duplicateMetadata, category: 'content', label: 'Duplicate metadata across scanned pages', status: input.duplicateMetadataSignal === null ? 'not_measured' : toStatus(!input.duplicateMetadataSignal), points: input.duplicateMetadataSignal === false ? CHECK_POINTS.duplicateMetadata : 0, maxPoints: CHECK_POINTS.duplicateMetadata, details: { duplicateMetadataSignal: input.duplicateMetadataSignal }, recommendation: 'Keep page titles and descriptions unique across the site.' }));

  const thinContentPass = (input.textWordCount ?? 0) >= THRESHOLDS.minWords;
  checks.push(makeCheck({ id: CHECK_IDS.thinContent, category: 'content', label: 'Thin content heuristic', status: input.textWordCount === null ? 'not_measured' : toStatus(thinContentPass), points: thinContentPass ? CHECK_POINTS.thinContent : 0, maxPoints: CHECK_POINTS.thinContent, details: { textWordCount: input.textWordCount, minimumWords: THRESHOLDS.minWords }, recommendation: 'Provide enough unique primary content for searchers.' }));

  const vitalsAvailable = input.webVitals.lcp !== null || input.webVitals.cls !== null || input.webVitals.inp !== null;
  const lcpPass = input.webVitals.lcp !== null && input.webVitals.lcp <= THRESHOLDS.webVitals.lcpGoodMs;
  const clsPass = input.webVitals.cls !== null && input.webVitals.cls <= THRESHOLDS.webVitals.clsGood;
  const inpPass = input.webVitals.inp !== null && input.webVitals.inp <= THRESHOLDS.webVitals.inpGoodMs;
  const vitalsPasses = [lcpPass, clsPass, inpPass].filter(Boolean).length;
  const vitalPoints = vitalsAvailable ? Number(((vitalsPasses / 3) * CHECK_POINTS.coreWebVitalsProxy).toFixed(2)) : 0;
  checks.push(makeCheck({ id: CHECK_IDS.coreWebVitalsProxy, category: 'performanceProxy', label: 'Core Web Vitals proxy', status: vitalsAvailable ? (vitalsPasses >= 2 ? 'pass' : 'warn') : 'not_measured', points: vitalPoints, maxPoints: CHECK_POINTS.coreWebVitalsProxy, details: input.webVitals, recommendation: 'Optimize LCP, CLS, and INP using existing performance evidence.' }));

  const weightAvailable = input.pageWeightBytes !== null || input.requestCount !== null;
  const weightPass = input.pageWeightBytes !== null && input.requestCount !== null
    ? input.pageWeightBytes <= THRESHOLDS.pageWeightMaxBytes && input.requestCount <= THRESHOLDS.requestCountMax
    : false;
  checks.push(makeCheck({ id: CHECK_IDS.pageWeightAndRequestCount, category: 'performanceProxy', label: 'Page weight/request count proxy', status: weightAvailable ? (weightPass ? 'pass' : 'warn') : 'not_measured', points: weightPass ? CHECK_POINTS.pageWeightAndRequestCount : 0, maxPoints: CHECK_POINTS.pageWeightAndRequestCount, details: { pageWeightBytes: input.pageWeightBytes, requestCount: input.requestCount, thresholds: { bytes: THRESHOLDS.pageWeightMaxBytes, requests: THRESHOLDS.requestCountMax } }, recommendation: 'Reduce payload and request overhead by deferring or compressing assets.' }));

  const categories: Record<SeoScoreCategory, SeoScoreCheck[]> = {
    indexability: checks.filter((check) => categoryFromCheck(check) === 'indexability'),
    onPage: checks.filter((check) => categoryFromCheck(check) === 'onPage'),
    content: checks.filter((check) => categoryFromCheck(check) === 'content'),
    performanceProxy: checks.filter((check) => categoryFromCheck(check) === 'performanceProxy')
  };

  const subscores = Object.fromEntries((Object.keys(categories) as SeoScoreCategory[]).map((category) => {
    const categoryChecks = categories[category];
    const measuredMax = categoryChecks.filter((check) => check.status !== 'not_measured').reduce((sum, check) => sum + check.maxPoints, 0);
    const measuredPoints = categoryChecks.filter((check) => check.status !== 'not_measured').reduce((sum, check) => sum + check.points, 0);
    const score = measuredMax > 0 ? Number(((measuredPoints / measuredMax) * 100).toFixed(2)) : 0;
    const measuredWeight = measuredMax > 0 ? 1 : 0;
    return [category, { score, measuredWeight, checks: categoryChecks }];
  })) as SeoScoreArtifact['subscores'];

  const weightedMeasuredTotal = (Object.keys(CATEGORY_WEIGHTS) as SeoScoreCategory[])
    .reduce((sum, category) => sum + (subscores[category].measuredWeight > 0 ? CATEGORY_WEIGHTS[category] : 0), 0);

  const overallRaw = weightedMeasuredTotal > 0
    ? (Object.keys(CATEGORY_WEIGHTS) as SeoScoreCategory[]).reduce((sum, category) => {
      if (subscores[category].measuredWeight === 0) return sum;
      const normalizedWeight = CATEGORY_WEIGHTS[category] / weightedMeasuredTotal;
      return sum + (subscores[category].score * normalizedWeight);
    }, 0)
    : 0;

  const overallScore = Number(overallRaw.toFixed(2));

  return {
    version: SEO_SCORE_VERSION,
    url: input.url,
    generatedAt: input.generatedAt,
    overallScore,
    weights: CATEGORY_WEIGHTS,
    subscores,
    checks
  };
}

export function scoreLabel(score: number): string {
  if (score >= 90) return 'Excellent';
  if (score >= 75) return 'Good';
  if (score >= 55) return 'Needs work';
  return 'Poor';
}

export const SEO_CATEGORY_POINT_TOTALS = CATEGORY_MAX_POINTS;
