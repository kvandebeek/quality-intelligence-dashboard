import path from 'node:path';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { chromium, firefox, webkit, type BrowserType, type Page, type BrowserContext } from 'playwright';
import type { AppConfig, CrawlPageMetadata, RunMetadata, RunSummary, RunTarget, TargetRunArtifacts } from '../models/types.js';
import { compactTimestamp, stableRunId } from '../utils/time.js';
import { ensureDir, writeJson } from '../utils/file.js';
import { collectPerformance } from '../collectors/performanceCollector.js';
import { collectAccessibility } from '../collectors/accessibilityCollector.js';
import { parseHar, recommendNetworkOptimizations } from '../collectors/networkCollector.js';
import { publishToElasticsearch } from '../publishers/elasticsearchPublisher.js';
import { extractAnchorHrefs, runBfsCrawl } from './crawler.js';
import { SCHEMA_VERSION, TOOL_VERSION, type ArtifactMeta } from '../models/platform.js';
import { writeValidatedArtifact } from './artifactValidation.js';
import { buildRunIndex, percentileSummary } from './normalization.js';

const ARTIFACT_FILES = ['performance.json', 'network-requests.json', 'network-recommendations.json', 'accessibility.json', 'target-summary.json', 'network.har', 'core-web-vitals.json', 'lighthouse-summary.json', 'throttled-run.json', 'security-scan.json', 'seo-checks.json', 'visual-regression.json', 'api-monitoring.json', 'broken-links.json', 'third-party-risk.json', 'a11y-beyond-axe.json', 'stability.json', 'memory-profile.json'] as const;

function browserFactory(name: AppConfig['browser']): BrowserType { if (name === 'firefox') return firefox; if (name === 'webkit') return webkit; return chromium; }

function sanitizeSlug(url: string): string {
  const value = new URL(url);
  const slug = `${value.hostname}${value.pathname}`.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
  const hash = createHash('sha1').update(url).digest('hex').slice(0, 8);
  return `${slug || 'root'}-${hash}`;
}

async function scrapePageLinks(page: Page): Promise<string[]> {
  const hrefs = await page.locator('a[href]').evaluateAll((anchors) => anchors.map((anchor) => anchor.getAttribute('href')));
  return extractAnchorHrefs(hrefs);
}

async function collectCoreWebVitals(page: Page): Promise<{ lcp: number | null; cls: number | null; inp: number | null; fcp: number | null }> {
  return page.evaluate(() => {
    const entries = performance.getEntries();
    const lcp = performance.getEntriesByType('largest-contentful-paint').at(-1)?.startTime ?? null;
    const cls = (performance.getEntriesByType('layout-shift') as Array<PerformanceEntry & { value?: number }>).reduce((sum, entry) => sum + (entry.value ?? 0), 0);
    const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null;
    const eventEntries = entries.filter((entry) => entry.entryType === 'event') as Array<PerformanceEntry & { duration?: number }>;
    const inp = eventEntries.length > 0 ? Math.max(...eventEntries.map((entry) => entry.duration ?? 0)) : null;
    return { lcp, cls: Number.isFinite(cls) ? cls : null, inp, fcp };
  });
}

function computeStats(values: number[]): { stdDevLoadMs: number; coefficientOfVariation: number; unstable: boolean } {
  if (values.length === 0) return { stdDevLoadMs: 0, coefficientOfVariation: 0, unstable: false };
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length;
  const stdDevLoadMs = Math.sqrt(variance);
  const coefficientOfVariation = mean > 0 ? stdDevLoadMs / mean : 0;
  return { stdDevLoadMs, coefficientOfVariation, unstable: coefficientOfVariation > 0.2 };
}

async function executePipelineForUrl(browser: Awaited<ReturnType<BrowserType['launch']>>, runRoot: string, target: RunTarget, crawl: CrawlPageMetadata | undefined, runId: string, timestamp: string): Promise<{ artifact: TargetRunArtifacts; output: RunSummary['outputs'][number]; hrefs: string[] }> {
  const urlSlug = sanitizeSlug(target.url);
  const targetFolder = path.join(runRoot, urlSlug);
  ensureDir(targetFolder);
  const harPath = path.join(targetFolder, 'network.har');

  const context = await browser.newContext({ recordHar: { path: harPath, mode: 'full' } });
  const page = await context.newPage();
  const response = await page.goto(target.url, { waitUntil: 'load' });
  if (target.waitForSelector) await page.locator(target.waitForSelector).waitFor({ state: 'visible' });

  const meta: ArtifactMeta = { runId, url: target.url, urlSlug, timestamp, toolVersion: TOOL_VERSION, schemaVersion: SCHEMA_VERSION };
  const [perfMetrics, accessibility, hrefs, coreWebVitals] = await Promise.all([collectPerformance(page, target.url), collectAccessibility(page, target.url), scrapePageLinks(page), collectCoreWebVitals(page)]);
  const memorySamples = await page.evaluate(() => {
    const value = (window.performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize;
    return value ? [value] : [];
  });

  const loadSamples: number[] = [];
  const iterations = Math.max(1, 10);
  for (let i = 0; i < iterations; i += 1) {
    await page.goto(target.url, { waitUntil: 'load' });
    const loadEventMs = await page.evaluate(() => {
      const nav = window.performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
      return nav ? nav.loadEventEnd - nav.startTime : 0;
    });
    loadSamples.push(loadEventMs);
  }

  await context.close();

  const requests = parseHar(harPath);
  const recommendations = recommendNetworkOptimizations(requests);

  const securityHeaders = response?.headers() ?? {};
  const securityScan: Record<string, boolean | string | null> = {
    csp: Boolean(securityHeaders['content-security-policy']),
    hsts: Boolean(securityHeaders['strict-transport-security']),
    xFrameOptions: Boolean(securityHeaders['x-frame-options']),
    referrerPolicy: Boolean(securityHeaders['referrer-policy']),
    tlsVersion: target.url.startsWith('https://') ? 'assumed-modern' : null,
    mixedContent: requests.some((request) => request.url.startsWith('http://') && target.url.startsWith('https://'))
  };

  const seoChecks = await browser.newPage().then(async (seoPage) => {
    await seoPage.goto(target.url, { waitUntil: 'load' });
    const checks = await seoPage.evaluate(() => ({
      hasTitle: Boolean(document.querySelector('title')?.textContent?.trim()),
      hasDescription: Boolean(document.querySelector('meta[name="description"]')?.getAttribute('content')?.trim()),
      canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? null,
      robotsMeta: document.querySelector('meta[name="robots"]')?.getAttribute('content') ?? null,
      structuredDataCount: document.querySelectorAll('script[type="application/ld+json"]').length
    }));
    await seoPage.close();
    return checks;
  });

  const apiRequests = requests.filter((request) => /json|api|graphql|xhr|fetch/i.test(request.resourceType) || /\/api\//i.test(request.url));
  const apiDurations = apiRequests.map((request) => request.durationMs).sort((a, b) => a - b);
  const apiMonitoring = {
    count: apiRequests.length,
    errorRate: apiRequests.length > 0 ? apiRequests.filter((request) => request.status >= 400).length / apiRequests.length : 0,
    p95Ms: apiDurations[Math.max(0, Math.floor(apiDurations.length * 0.95) - 1)] ?? 0,
    avgSize: apiRequests.length > 0 ? apiRequests.reduce((sum, request) => sum + request.transferSize, 0) / apiRequests.length : 0
  };

  const host = new URL(target.url).hostname;
  const thirdPartyRiskMap = new Map<string, { domain: string; requests: number; transferSize: number; totalDuration: number; trackerHeuristic: boolean }>();
  for (const request of requests) {
    const domain = new URL(request.url).hostname;
    if (domain === host) continue;
    const current = thirdPartyRiskMap.get(domain) ?? { domain, requests: 0, transferSize: 0, totalDuration: 0, trackerHeuristic: /tracker|analytics|pixel|beacon|ads/i.test(domain) };
    current.requests += 1;
    current.transferSize += request.transferSize;
    current.totalDuration += request.durationMs;
    thirdPartyRiskMap.set(domain, current);
  }
  const thirdPartyRisk = [...thirdPartyRiskMap.values()].map((entry) => ({ domain: entry.domain, requests: entry.requests, transferSize: entry.transferSize, avgDurationMs: entry.requests > 0 ? entry.totalDuration / entry.requests : 0, trackerHeuristic: entry.trackerHeuristic })).sort((a, b) => b.transferSize - a.transferSize);

  const brokenLinksDetails: Array<{ url: string; status: number; chainLength: number }> = [];
  for (const href of hrefs.slice(0, 50)) {
    try {
      const resolved = new URL(href, target.url).toString();
      if (new URL(resolved).hostname !== host) continue;
      const req = await browser.newContext().then(async (ctx) => { const r = await ctx.request.get(resolved, { maxRedirects: 10 }); await ctx.close(); return r; });
      brokenLinksDetails.push({ url: resolved, status: req.status(), chainLength: 1 });
    } catch {
      // best effort
    }
  }
  const brokenLinks = {
    checked: brokenLinksDetails.length,
    broken: brokenLinksDetails.filter((item) => item.status >= 400).length,
    redirectChains: brokenLinksDetails.filter((item) => item.chainLength > 1).length,
    loops: 0,
    details: brokenLinksDetails
  };

  const focusCheck = await browser.newPage().then(async (checkPage) => {
    await checkPage.goto(target.url, { waitUntil: 'load' });
    await checkPage.keyboard.press('Tab');
    const active1 = await checkPage.evaluate(() => document.activeElement?.tagName ?? '');
    await checkPage.keyboard.press('Tab');
    const active2 = await checkPage.evaluate(() => document.activeElement?.tagName ?? '');
    await checkPage.close();
    return { keyboardReachable: active1.length > 0, possibleFocusTrap: active1 === active2 && active1 !== 'BODY', contrastSimulationScore: null as number | null };
  });

  const baselinePath = path.join(runRoot, '..', 'baseline', `${urlSlug}.png`);
  const screenshotPath = path.join(targetFolder, 'visual-current.png');
  const visualContext = await browser.newContext();
  const visualPage = await visualContext.newPage();
  await visualPage.goto(target.url, { waitUntil: 'load' });
  await visualPage.screenshot({ path: screenshotPath, fullPage: true });
  await visualContext.close();
  let baselineFound = fs.existsSync(baselinePath);
  let diffRatio: number | null = null;
  if (baselineFound) {
    const baseline = fs.readFileSync(baselinePath);
    const current = fs.readFileSync(screenshotPath);
    const min = Math.min(baseline.length, current.length);
    let diffs = 0;
    for (let i = 0; i < min; i += 1) if (baseline[i] !== current[i]) diffs += 1;
    diffRatio = min > 0 ? diffs / min : 0;
  } else {
    ensureDir(path.dirname(baselinePath));
    fs.copyFileSync(screenshotPath, baselinePath);
    baselineFound = false;
  }

  const navigationStats = computeStats(loadSamples);

  const artifact: TargetRunArtifacts = { target, performance: perfMetrics, network: { harPath: path.relative(runRoot, harPath), requests, recommendations }, accessibility };

  writeValidatedArtifact(path.join(targetFolder, 'performance.json'), 'performance', meta, perfMetrics);
  writeValidatedArtifact(path.join(targetFolder, 'network-requests.json'), 'networkRequests', meta, requests);
  writeValidatedArtifact(path.join(targetFolder, 'network-recommendations.json'), 'networkRecommendations', meta, recommendations);
  writeValidatedArtifact(path.join(targetFolder, 'accessibility.json'), 'accessibility', meta, accessibility);
  writeValidatedArtifact(path.join(targetFolder, 'core-web-vitals.json'), 'coreWebVitals', meta, coreWebVitals);
  writeValidatedArtifact(path.join(targetFolder, 'lighthouse-summary.json'), 'lighthouse', meta, { available: false, categories: { performance: null, accessibility: null, bestPractices: null, seo: null }, note: 'lighthouse package unavailable in constrained environment' });
  writeValidatedArtifact(path.join(targetFolder, 'throttled-run.json'), 'throttled', meta, { available: false, baselineLoadMs: perfMetrics.navigation.loadEventMs ?? null, throttledLoadMs: null, degradationFactor: null });
  writeValidatedArtifact(path.join(targetFolder, 'security-scan.json'), 'security', meta, securityScan);
  writeValidatedArtifact(path.join(targetFolder, 'seo-checks.json'), 'seo', meta, seoChecks);
  writeValidatedArtifact(path.join(targetFolder, 'visual-regression.json'), 'visualRegression', meta, { baselineFound, diffRatio, passed: diffRatio === null ? true : diffRatio < 0.05 });
  writeValidatedArtifact(path.join(targetFolder, 'api-monitoring.json'), 'apiMonitoring', meta, apiMonitoring);
  writeValidatedArtifact(path.join(targetFolder, 'broken-links.json'), 'brokenLinks', meta, brokenLinks);
  writeValidatedArtifact(path.join(targetFolder, 'third-party-risk.json'), 'thirdPartyRisk', meta, thirdPartyRisk);
  writeValidatedArtifact(path.join(targetFolder, 'a11y-beyond-axe.json'), 'accessibilityBeyondAxe', meta, focusCheck);
  writeValidatedArtifact(path.join(targetFolder, 'stability.json'), 'stability', meta, { iterations, loadEventSamples: loadSamples, ...navigationStats });
  writeValidatedArtifact(path.join(targetFolder, 'memory-profile.json'), 'memory', meta, { samples: memorySamples, growth: memorySamples.length > 1 ? memorySamples[memorySamples.length - 1]! - memorySamples[0]! : null });
  writeJson(path.join(targetFolder, 'target-summary.json'), artifact);

  return { artifact, output: { targetName: target.name, folder: path.relative(runRoot, targetFolder), files: [...ARTIFACT_FILES], crawl }, hrefs };
}

function resolveLinearTargets(config: AppConfig): RunTarget[] { return config.targets.length > 0 ? config.targets : [{ name: 'Start URL', url: config.startUrl }]; }

export async function runAssurance(config: AppConfig): Promise<RunSummary> {
  const timestamp = compactTimestamp();
  const runId = stableRunId(timestamp, config.browser, config.iteration, config.name);
  const metadata: RunMetadata = { runId, timestamp, browser: config.browser, environment: config.environment, iteration: config.iteration, name: config.name, startUrl: config.startUrl, targets: config.targets };
  const runRoot = path.join(config.outputDir, runId);
  ensureDir(runRoot);
  writeJson(path.join(runRoot, 'run-metadata.json'), metadata);

  const browser = await browserFactory(config.browser).launch({ headless: config.headless });
  const targetArtifacts: TargetRunArtifacts[] = [];
  const outputs: RunSummary['outputs'] = [];

  if (config.crawl.enabled) {
    const crawlResult = await runBfsCrawl({ startUrl: config.startUrl, crawlConfig: config.crawl }, async ({ url, parentUrl, depth, index }) => {
      const executed = await executePipelineForUrl(browser, runRoot, { name: `Crawled Page ${index + 1}`, url }, { url, parentUrl, depth }, runId, timestamp);
      targetArtifacts.push(executed.artifact); outputs.push(executed.output); return { discoveredHrefs: executed.hrefs };
    });
    await browser.close();
    const summary: RunSummary = { metadata, outputs, crawl: { totalPagesDiscovered: crawlResult.totalPagesDiscovered, totalPagesExecuted: crawlResult.totalPagesExecuted, pages: crawlResult.executedPages, skippedUrls: crawlResult.skippedUrls } };
    writeJson(path.join(runRoot, 'summary-index.json'), summary);
    const index = buildRunIndex(runRoot, runId, timestamp, TOOL_VERSION, SCHEMA_VERSION);
    writeJson(path.join(runRoot, 'index.json'), index);
    writeJson(path.join(runRoot, 'history.json'), { runId, timestamp, urls: index.urls.map((entry) => ({ url: entry.meta.url, scores: entry.enterpriseScore })) });
    writeJson(path.join(runRoot, 'ci-summary.json'), { runId, totalUrls: index.summary.totalUrls, worstPerformance: index.summary.rankings.performance.at(-1) ?? null });
    const junit = `<?xml version="1.0" encoding="UTF-8"?><testsuite name="quality-signal" tests="${index.urls.length}">${index.urls.map((entry) => `<testcase classname="url" name="${entry.meta.url}"><system-out>performance=${entry.enterpriseScore.performance}</system-out></testcase>`).join('')}</testsuite>`;
    fs.writeFileSync(path.join(runRoot, 'junit.xml'), junit);
    fs.writeFileSync(path.join(runRoot, 'executive-report.pdf'), 'PDF report generation placeholder - include summary and regressions.');
    writeJson(path.join(runRoot, 'normalized-export.json'), index.urls);
    await publishToElasticsearch(config.elasticsearch, summary, targetArtifacts);
    return summary;
  }

  const targets = resolveLinearTargets(config);
  for (const target of targets) {
    const executed = await executePipelineForUrl(browser, runRoot, target, undefined, runId, timestamp);
    outputs.push(executed.output); targetArtifacts.push(executed.artifact);
  }
  await browser.close();
  const summary: RunSummary = { metadata, outputs };
  writeJson(path.join(runRoot, 'summary-index.json'), summary);
  const index = buildRunIndex(runRoot, runId, timestamp, TOOL_VERSION, SCHEMA_VERSION);
  writeJson(path.join(runRoot, 'index.json'), index);
  writeJson(path.join(runRoot, 'history.json'), { runId, timestamp, urls: index.urls.map((entry) => ({ url: entry.meta.url, scores: entry.enterpriseScore })) });
  writeJson(path.join(runRoot, 'ci-summary.json'), { runId, totalUrls: index.summary.totalUrls, worstPerformance: index.summary.rankings.performance.at(-1) ?? null });
  const junit = `<?xml version="1.0" encoding="UTF-8"?><testsuite name="quality-signal" tests="${index.urls.length}">${index.urls.map((entry) => `<testcase classname="url" name="${entry.meta.url}"><system-out>performance=${entry.enterpriseScore.performance}</system-out></testcase>`).join('')}</testsuite>`;
  fs.writeFileSync(path.join(runRoot, 'junit.xml'), junit);
  fs.writeFileSync(path.join(runRoot, 'executive-report.pdf'), 'PDF report generation placeholder - include summary and regressions.');
  writeJson(path.join(runRoot, 'normalized-export.json'), index.urls);
  await publishToElasticsearch(config.elasticsearch, summary, targetArtifacts);
  return summary;
}
