import path from 'node:path';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { chromium, firefox, webkit, type Browser, type BrowserType, type Page, type BrowserContext } from 'playwright';
import { CROSS_BROWSER_PERFORMANCE_FILE, type AppConfig, type CrawlPageMetadata, type RunMetadata, type RunSummary, type RunTarget, type TargetRunArtifacts } from '../models/types.js';
import { collectClientErrors, collectDependencyRisk, collectMemoryLeaks, collectPrivacyAudit, collectRuntimeSecurity, collectThirdPartyResilience, installErrorAndUxObservers } from '../collectors/extensionPackCollector.js';
import { compactTimestamp, stableRunId } from '../utils/time.js';
import { ensureDir, writeJson } from '../utils/file.js';
import { ensureUniqueRunRoot } from '../utils/artifactPaths.js';
import { collectPerformance } from '../collectors/performanceCollector.js';
import { collectCrossBrowserPerformance } from '../collectors/crossBrowserPerformanceCollector.js';
import { loadCrossBrowserConfig } from '../config/loadCrossBrowserConfig.js';
import { collectAccessibility } from '../collectors/accessibilityCollector.js';
import { publishToElasticsearch } from '../publishers/elasticsearchPublisher.js';
import { extractAnchorHrefs, runBfsCrawl } from './crawler.js';
import { SCHEMA_VERSION, TOOL_VERSION, type ArtifactMeta } from '../models/platform.js';
import { writeValidatedArtifact } from './artifactValidation.js';
import { buildRunIndex, percentileSummary } from './normalization.js';
import { TestTimingTracker } from './testTiming.js';
import { gotoWithConsent } from '../utils/consent/goto-with-consent.js';
import { computeSeoScore } from '../collectors/seoScore/computeSeoScore.js';
import { extractSeoSignals } from '../collectors/seoScore/extractSeoSignals.js';
import { collectUxSuite } from '../collectors/uxSuiteCollector.js';

const ARTIFACT_FILES = ['performance.json', 'accessibility.json', 'target-summary.json', 'core-web-vitals.json', 'lighthouse-summary.json', 'throttled-run.json', 'security-scan.json', 'seo-score.json', 'visual-regression.json', 'broken-links.json', 'third-party-risk.json', 'a11y-beyond-axe.json', 'stability.json', 'memory-profile.json', CROSS_BROWSER_PERFORMANCE_FILE, 'client-errors.json', 'memory-leaks.json', 'third-party-resilience.json', 'privacy-audit.json', 'runtime-security.json', 'dependency-risk.json', 'regression-summary.json', 'ux-overview.json', 'ux-sanity.json', 'ux-layout-stability.json', 'ux-interaction.json', 'ux-click-friction.json', 'ux-keyboard.json', 'ux-overlays.json', 'ux-readability.json', 'ux-forms.json', 'ux-visual-regression.json'] as const;
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
    const lcp = performance.getEntriesByType('largest-contentful-paint').at(-1)?.startTime ?? performance.getEntriesByName('largest-contentful-paint').at(-1)?.startTime ?? null;
    const cls = (performance.getEntriesByType('layout-shift') as Array<PerformanceEntry & { value?: number }>).reduce((sum, entry) => sum + (entry.value ?? 0), 0);
    const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null;
    const eventEntries = entries.filter((entry) => entry.entryType === 'event') as Array<PerformanceEntry & { duration?: number }>;
    const inp = eventEntries.length > 0 ? Math.max(...eventEntries.map((entry) => entry.duration ?? 0)) : null;
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    return {
      lcp: Number.isFinite(lcp) ? Math.round(lcp as number) : (navigation ? Math.round(navigation.responseEnd - navigation.startTime) : null),
      cls: Number.isFinite(cls) ? Number((cls as number).toFixed(3)) : 0,
      inp: Number.isFinite(inp) ? Math.round(inp as number) : (navigation ? Math.round(navigation.domInteractive - navigation.startTime) : null),
      fcp: Number.isFinite(fcp) ? Math.round(fcp as number) : (navigation ? Math.round(navigation.responseStart - navigation.startTime) : null)
    };
  });
}

function toScore(value: number, good: number, poor: number): number {
  if (value <= good) return 100;
  if (value >= poor) return 0;
  return Math.round((1 - ((value - good) / (poor - good))) * 100);
}

function computeStats(values: number[]): { stdDevLoadMs: number; coefficientOfVariation: number; unstable: boolean } {
  if (values.length === 0) return { stdDevLoadMs: 0, coefficientOfVariation: 0, unstable: false };
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length;
  const stdDevLoadMs = Math.sqrt(variance);
  const coefficientOfVariation = mean > 0 ? stdDevLoadMs / mean : 0;
  return { stdDevLoadMs, coefficientOfVariation, unstable: coefficientOfVariation > 0.2 };
}


function parseDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

const robotsAllowCache = new Map<string, { disallows: string[]; fetched: boolean }>();
async function isPathAllowedByRobots(browser: Browser, pageUrl: string): Promise<boolean | null> {
  try {
    const url = new URL(pageUrl);
    const cacheKey = `${url.protocol}//${url.host}`;
    if (!robotsAllowCache.has(cacheKey)) {
      const ctx = await browser.newContext();
      const robotsResponse = await ctx.request.get(`${cacheKey}/robots.txt`, { failOnStatusCode: false, timeout: 5000 });
      const body = robotsResponse.ok() ? await robotsResponse.text() : '';
      await ctx.close();
      const disallows = body.split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => /^disallow:/i.test(line))
        .map((line) => line.split(':').slice(1).join(':').trim())
        .filter((pathValue) => pathValue.length > 0);
      robotsAllowCache.set(cacheKey, { disallows, fetched: robotsResponse.ok() });
    }
    const cached = robotsAllowCache.get(cacheKey);
    if (!cached || !cached.fetched) return null;
    return !cached.disallows.some((pathRule) => url.pathname.startsWith(pathRule));
  } catch {
    return null;
  }
}

function readJsonIfExists(filePath: string): Record<string, unknown> | null {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw) as Record<string, unknown>;
}

function computeRiskLevel(totalDelta: number, watchThreshold: number, elevatedThreshold: number): 'ok' | 'watch' | 'elevated' {
  if (totalDelta >= elevatedThreshold) return 'elevated';
  if (totalDelta >= watchThreshold) return 'watch';
  return 'ok';
}

function buildRegressionSummary(runRoot: string, outputDir: string, thresholds: AppConfig['assuranceModules']['regression']): Record<string, unknown> {
  const latestPointerPath = path.join(outputDir, 'latest-run.json');
  const latestPointer = readJsonIfExists(latestPointerPath);
  const previousRunPath = latestPointer && typeof latestPointer.path === 'string' ? String(latestPointer.path) : null;
  if (!previousRunPath || !fs.existsSync(previousRunPath)) {
    return { baseline: 'no baseline', message: 'No previous run baseline found. Regression deltas will be available from the next run onward.', targets: [] };
  }

  const summaryIndex = readJsonIfExists(path.join(runRoot, 'summary-index.json'));
  const previousSummary = readJsonIfExists(path.join(previousRunPath, 'summary-index.json'));
  const currentOutputs = Array.isArray(summaryIndex?.outputs) ? summaryIndex?.outputs as Array<Record<string, unknown>> : [];
  const previousOutputs = Array.isArray(previousSummary?.outputs) ? previousSummary?.outputs as Array<Record<string, unknown>> : [];

  const deltas = currentOutputs.map((output) => {
    const folder = String(output.folder ?? '');
    const previous = previousOutputs.find((item) => String(item.folder ?? '') === folder);
    const currentClientErrors = readJsonIfExists(path.join(runRoot, folder, 'client-errors.json'));
    const previousClientErrors = previous ? readJsonIfExists(path.join(previousRunPath, folder, 'client-errors.json')) : null;
    const currentRuntimeSecurity = readJsonIfExists(path.join(runRoot, folder, 'runtime-security.json'));
    const previousRuntimeSecurity = previous ? readJsonIfExists(path.join(previousRunPath, folder, 'runtime-security.json')) : null;

    const currentErrScore = Number(((currentClientErrors?.payload as Record<string, unknown> | undefined)?.severityScore) ?? 100);
    const previousErrScore = Number(((previousClientErrors?.payload as Record<string, unknown> | undefined)?.severityScore) ?? 100);
    const currentSecScore = Number(((currentRuntimeSecurity?.payload as Record<string, unknown> | undefined)?.securityScore) ?? 100);
    const previousSecScore = Number(((previousRuntimeSecurity?.payload as Record<string, unknown> | undefined)?.securityScore) ?? 100);
    const totalDelta = Math.max(0, (previousErrScore - currentErrScore)) + Math.max(0, (previousSecScore - currentSecScore));

    return {
      targetName: output.targetName ?? folder,
      folder,
      deltas: {
        clientErrorSeverityDelta: currentErrScore - previousErrScore,
        runtimeSecurityDelta: currentSecScore - previousSecScore
      },
      riskLevel: computeRiskLevel(totalDelta, thresholds.watchThreshold, thresholds.elevatedThreshold)
    };
  });

  const riskCounts = deltas.reduce((acc, item) => {
    const key = String(item.riskLevel) as 'ok' | 'watch' | 'elevated';
    acc[key] += 1;
    return acc;
  }, { ok: 0, watch: 0, elevated: 0 });

  return {
    baseline: previousRunPath,
    comparedRun: path.basename(previousRunPath),
    generatedAt: new Date().toISOString(),
    targets: deltas,
    summary: riskCounts
  };
}

async function executePipelineForUrl(browser: Awaited<ReturnType<BrowserType['launch']>>, runRoot: string, target: RunTarget, crawl: CrawlPageMetadata | undefined, runId: string, timestamp: string, timing: TestTimingTracker, config: AppConfig, retry = 0): Promise<{ artifact: TargetRunArtifacts; output: RunSummary['outputs'][number]; hrefs: string[]; extensionScores: Record<string, number | string | null> }> {
  const urlSlug = sanitizeSlug(target.url);
  const targetFolder = path.join(runRoot, urlSlug);
  ensureDir(targetFolder);
  const testReference = timing.startTest('src/core/runEngine.ts', target.name, retry);

  const context = await timing.step(testReference, 'Create browser context', async () => browser.newContext());
  const page = await timing.step(testReference, 'Create page', async () => context.newPage());

  await timing.step(testReference, 'Init extension observers', async () => installErrorAndUxObservers(page, config.assuranceModules));

  try {
    const response = await timing.step(testReference, 'Navigate to target URL', async () => gotoWithConsent(page, target.url, { gotoOptions: { waitUntil: 'load' }, consent: config.consent }).then((result) => result.response));
    if (target.waitForSelector) {
      await timing.step(testReference, `Wait for selector: ${target.waitForSelector}`, async () => page.locator(target.waitForSelector as string).waitFor({ state: 'visible' }));
    }

    const meta: ArtifactMeta = { runId, url: target.url, urlSlug, timestamp, toolVersion: TOOL_VERSION, schemaVersion: SCHEMA_VERSION };
    const runArtifactStep = async <T>(stepName: string, operation: () => Promise<T>): Promise<T> => {
      return timing.step(testReference, stepName, async () => {
        try {
          return await operation();
        } catch (error) {
          const details = error instanceof Error ? error.stack ?? error.message : String(error);
          process.stderr.write(`Artifact step failed [${stepName}] for ${target.name}: ${details}\n`);
          throw error;
        }
      });
    };

    const [perfMetrics, accessibility, hrefs, coreWebVitals] = await timing.step(testReference, 'Collect core artifacts', async () => {
      const performancePromise = runArtifactStep('Artifact: Performance metrics', async () => collectPerformance(page, target.url));
      const accessibilityPromise = runArtifactStep('Artifact: Accessibility', async () => collectAccessibility(page, target.url));
      const pageLinksPromise = runArtifactStep('Artifact: Page links', async () => scrapePageLinks(page));
      const webVitalsPromise = runArtifactStep('Artifact: Core Web Vitals', async () => collectCoreWebVitals(page));

      return Promise.all([performancePromise, accessibilityPromise, pageLinksPromise, webVitalsPromise]);
    });

    const memorySamples = await page.evaluate(() => {
    const value = (window.performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize;
    return value ? [value] : [];
    });

    const loadSamples: number[] = [];
    const loadSampleTimestamps: string[] = [];
    const iterations = 5;
    for (let i = 0; i < iterations; i += 1) {
      await gotoWithConsent(page, target.url, { gotoOptions: { waitUntil: 'load' }, consent: config.consent });
      const loadEventMs = await page.evaluate(() => {
        const nav = window.performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
        return nav ? Math.round(nav.loadEventEnd - nav.startTime) : 0;
      });
      loadSamples.push(loadEventMs);
      loadSampleTimestamps.push(new Date().toISOString());
      const heap = await page.evaluate(() => (window.performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null);
      if (typeof heap === 'number') memorySamples.push(heap);
    }


    const requests: Array<{ url: string; resourceType: string; transferSize: number; durationMs: number }> = [];

  const securityHeaders = response?.headers() ?? {};
  const securityScan: Record<string, boolean | string | null> = {
    csp: Boolean(securityHeaders['content-security-policy']),
    hsts: Boolean(securityHeaders['strict-transport-security']),
    xFrameOptions: Boolean(securityHeaders['x-frame-options']),
    referrerPolicy: Boolean(securityHeaders['referrer-policy']),
    tlsVersion: target.url.startsWith('https://') ? 'TLS (HTTPS)' : 'No TLS (HTTP)',
    mixedContent: requests.some((request) => request.url.startsWith('http://') && target.url.startsWith('https://'))
  };

  const seoContext = await browser.newContext();
  const seoPage = await seoContext.newPage();
  const seoResponse = await gotoWithConsent(seoPage, target.url, { gotoOptions: { waitUntil: 'load' }, consent: config.consent });

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

  const robotsTxtAllows = await isPathAllowedByRobots(browser, target.url);
  const seoSignals = await extractSeoSignals({
    page: seoPage,
    url: target.url,
    response: seoResponse.response,
    responseHeaders: seoResponse.response?.headers() ?? {},
    robotsTxtAllows,
    brokenInternalLinksCount: brokenLinks.broken,
    duplicateMetadataSignal: null,
    webVitals: { lcp: coreWebVitals.lcp, cls: coreWebVitals.cls, inp: coreWebVitals.inp },
    pageWeightBytes: perfMetrics.resourceSummary.transferSize,
    requestCount: perfMetrics.resourceSummary.count
  });
  const seoScore = computeSeoScore(seoSignals);
  await seoContext.close();

  const focusCheck = await browser.newPage().then(async (checkPage) => {
    try {
      await gotoWithConsent(checkPage, target.url, { gotoOptions: { waitUntil: 'load' }, consent: config.consent });
      await checkPage.keyboard.press('Tab');
      const active1 = await checkPage.evaluate(() => document.activeElement?.tagName ?? '');
      await checkPage.keyboard.press('Tab');
      const active2 = await checkPage.evaluate(() => document.activeElement?.tagName ?? '');
      const keyboardReachable = active1.length > 0;
      const possibleFocusTrap = active1 === active2 && active1 !== 'BODY';
      const contrastSimulationScore = keyboardReachable ? (possibleFocusTrap ? 60 : 100) : 0;
      await checkPage.close();
      return { keyboardReachable, possibleFocusTrap, contrastSimulationScore, contrastSimulationScoreReason: null as string | null };
    } catch {
      await checkPage.close();
      return { keyboardReachable: false, possibleFocusTrap: false, contrastSimulationScore: null as number | null, contrastSimulationScoreReason: 'Unable to evaluate keyboard contrast simulation on this page' };
    }
  });

  const baselinePath = path.join(runRoot, '..', 'baseline', `${urlSlug}.png`);
  const screenshotPath = path.join(targetFolder, 'visual-current.png');
  const visualContext = await browser.newContext();
  const visualPage = await visualContext.newPage();
  await gotoWithConsent(visualPage, target.url, { gotoOptions: { waitUntil: 'load' }, consent: config.consent });
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
  const loadedCrossBrowserConfig = loadCrossBrowserConfig();
  const crossBrowserPerformance = await runArtifactStep('Artifact: Cross-browser performance', async () => collectCrossBrowserPerformance({
    url: target.url,
    consent: config.consent,
    headless: config.headless,
    loadedConfig: loadedCrossBrowserConfig,
    stepRunner: async (stepName, operation) => timing.step(testReference, stepName, operation),
    defaultNavigationTimeoutMs: 30000
  }));
  const baselineLoadMs = perfMetrics.navigation.loadEventMs ?? null;
  const throttledContext = await browser.newContext();
  const throttledPage = await throttledContext.newPage();
  await throttledPage.route('**/*', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 120));
    await route.continue();
  });
  await gotoWithConsent(throttledPage, target.url, { gotoOptions: { waitUntil: 'load' }, consent: config.consent });
  const throttledLoadMs = await throttledPage.evaluate(() => {
    const nav = window.performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    return nav ? Math.round(nav.loadEventEnd - nav.startTime) : null;
  });
  await throttledContext.close();

  const lcp = coreWebVitals.lcp ?? baselineLoadMs ?? 0;
  const inp = coreWebVitals.inp ?? 0;
  const cls = coreWebVitals.cls ?? 0;
  const perfScore = Math.round((toScore(lcp, 2500, 4000) + toScore(inp, 200, 500) + toScore(cls, 0.1, 0.25)) / 3);
  const lighthouseSummary = {
    available: true,
    categories: {
      performance: perfScore,
      accessibility: Math.max(0, 100 - (accessibility.issues?.length ?? 0) * 5),
      bestPractices: Math.max(0, 100 - (securityScan.mixedContent ? 20 : 0)),
      seo: seoScore.overallScore
    }
  };

  const artifact: TargetRunArtifacts = { target, performance: perfMetrics, accessibility };

  writeValidatedArtifact(path.join(targetFolder, 'performance.json'), 'performance', meta, perfMetrics);
  writeValidatedArtifact(path.join(targetFolder, 'accessibility.json'), 'accessibility', meta, accessibility);
  writeValidatedArtifact(path.join(targetFolder, 'core-web-vitals.json'), 'coreWebVitals', meta, coreWebVitals);
  writeValidatedArtifact(path.join(targetFolder, 'lighthouse-summary.json'), 'lighthouse', meta, lighthouseSummary);
  writeValidatedArtifact(path.join(targetFolder, 'throttled-run.json'), 'throttled', meta, { available: throttledLoadMs !== null, baselineLoadMs, throttledLoadMs, degradationFactor: baselineLoadMs && throttledLoadMs ? Number((throttledLoadMs / baselineLoadMs).toFixed(2)) : null });
  writeValidatedArtifact(path.join(targetFolder, 'security-scan.json'), 'security', meta, securityScan);
  writeValidatedArtifact(path.join(targetFolder, 'seo-score.json'), 'seoScore', meta, seoScore);
  writeValidatedArtifact(path.join(targetFolder, 'visual-regression.json'), 'visualRegression', meta, { baselineFound, diffRatio, passed: diffRatio === null ? true : diffRatio < 0.05 });
  writeValidatedArtifact(path.join(targetFolder, 'broken-links.json'), 'brokenLinks', meta, brokenLinks);
  writeValidatedArtifact(path.join(targetFolder, 'third-party-risk.json'), 'thirdPartyRisk', meta, thirdPartyRisk);
  writeValidatedArtifact(path.join(targetFolder, 'a11y-beyond-axe.json'), 'accessibilityBeyondAxe', meta, focusCheck);
  writeValidatedArtifact(path.join(targetFolder, 'stability.json'), 'stability', meta, { iterations, loadEventSamples: loadSamples.map((value) => Math.round(value)), timestamps: loadSampleTimestamps, ...navigationStats });
  writeValidatedArtifact(path.join(targetFolder, 'memory-profile.json'), 'memory', meta, { samples: memorySamples, growth: memorySamples.length > 1 ? Math.round(memorySamples[memorySamples.length - 1]! - memorySamples[0]!) : 0 });
  writeValidatedArtifact(path.join(targetFolder, CROSS_BROWSER_PERFORMANCE_FILE), 'crossBrowserPerformance', meta, crossBrowserPerformance);
  const clientErrors = config.assuranceModules.enabled.clientErrors ? await timing.step(testReference, 'Extension: Client errors', async () => collectClientErrors(page, config.assuranceModules)) : { totalErrors: 0, severityScore: 100, uncaughtExceptions: 0, unhandledRejections: 0, consoleErrors: 0, consoleWarnings: 0, failedRequests: [], topErrors: [] };
  const memoryLeaks = config.assuranceModules.enabled.memoryLeaks ? await timing.step(testReference, 'Extension: Memory leaks', async () => collectMemoryLeaks(page, config.assuranceModules)) : { available: false, mode: 'not_supported', initialHeapMB: null, finalHeapMB: null, growthMB: null, leakRisk: 'unknown', evidence: ['disabled'] };
  const thirdPartyDomains = [...new Set(requests.map((request) => parseDomain(request.url)).filter((domain) => domain && domain !== parseDomain(target.url)))];
  const thirdPartyResilience = config.assuranceModules.enabled.thirdPartyResilience ? await timing.step(testReference, 'Extension: Third-party resilience', async () => collectThirdPartyResilience(browser, target.url, thirdPartyDomains, config.assuranceModules)) : { blockedDomains: [], functionalBreakage: false, layoutImpact: 'none', resilienceScore: 100 };
  const privacyAudit = config.assuranceModules.enabled.privacyAudit ? await timing.step(testReference, 'Extension: Privacy audit', async () => collectPrivacyAudit(page, config.assuranceModules)) : { consentBannerDetected: false, cookiesBeforeConsent: [], insecureCookies: [], thirdPartyTrackers: [], gdprRisk: 'low' };
  const runtimeSecurity = config.assuranceModules.enabled.runtimeSecurity ? await timing.step(testReference, 'Extension: Runtime security', async () => collectRuntimeSecurity(page, target.url)) : { missingHeaders: [], cspStrength: 'none', mixedContent: [], inlineScripts: 0, evalSignals: 0, securityScore: 100 };
  const dependencyRisk = config.assuranceModules.enabled.dependencyRisk ? await timing.step(testReference, 'Extension: Dependency risk', async () => collectDependencyRisk(page, parseDomain(target.url), config.assuranceModules)) : { domainInventory: [], dependencyRiskScore: 100, topRiskyDependencies: [] };

  writeValidatedArtifact(path.join(targetFolder, 'client-errors.json'), 'clientErrors', meta, clientErrors);
  writeValidatedArtifact(path.join(targetFolder, 'memory-leaks.json'), 'memoryLeaks', meta, memoryLeaks);
  writeValidatedArtifact(path.join(targetFolder, 'third-party-resilience.json'), 'thirdPartyResilience', meta, thirdPartyResilience);
  writeValidatedArtifact(path.join(targetFolder, 'privacy-audit.json'), 'privacyAudit', meta, privacyAudit);
  writeValidatedArtifact(path.join(targetFolder, 'runtime-security.json'), 'runtimeSecurity', meta, runtimeSecurity);
  writeValidatedArtifact(path.join(targetFolder, 'dependency-risk.json'), 'dependencyRisk', meta, dependencyRisk);

  if (config.assuranceModules.enabled.uxSuite) {
    await timing.step(testReference, 'Artifact: UX suite', async () => collectUxSuite(page, {
      runId,
      url: target.url,
      timestamp,
      browserName: config.browser,
      viewport: { width: page.viewportSize()?.width ?? 1366, height: page.viewportSize()?.height ?? 768 },
      outputDir: targetFolder,
      config
    }));
  }
  await timing.step(testReference, 'Write target summary', async () => Promise.resolve(writeJson(path.join(targetFolder, 'target-summary.json'), artifact)));

    timing.endTest(testReference, 'passed');
    return { artifact, output: { targetName: target.name, folder: path.relative(runRoot, targetFolder), files: [...ARTIFACT_FILES], crawl }, hrefs, extensionScores: { clientErrors: clientErrors.severityScore, memory: memoryLeaks.growthMB, resilience: thirdPartyResilience.resilienceScore, privacy: privacyAudit.gdprRisk, runtimeSecurity: runtimeSecurity.securityScore, dependency: dependencyRisk.dependencyRiskScore } };
  } catch (error) {
    timing.endTest(testReference, 'failed');
    throw error;
  } finally {
    await timing.step(testReference, 'Close browser context', async () => context.close());
  }
}

function resolveLinearTargets(config: AppConfig): RunTarget[] { return config.targets.length > 0 ? config.targets : [{ name: 'Start URL', url: config.startUrl }]; }

export async function runAssurance(config: AppConfig): Promise<RunSummary> {
  const timestamp = compactTimestamp();
  const runId = stableRunId(timestamp, config.browser, config.iteration, config.name);
  const metadata: RunMetadata = { runId, timestamp, browser: config.browser, environment: config.environment, iteration: config.iteration, name: config.name, startUrl: config.startUrl, targets: config.targets };
  const runRoot = ensureUniqueRunRoot(config.outputDir, runId);
  ensureDir(runRoot);
  writeJson(path.join(runRoot, 'run-metadata.json'), metadata);
  const timing = new TestTimingTracker(runId);

  const browser = await browserFactory(config.browser).launch({ headless: config.headless });
  const targetArtifacts: TargetRunArtifacts[] = [];
  const outputs: RunSummary['outputs'] = [];

  try {
    if (config.crawl.enabled) {
    const crawlResult = await runBfsCrawl({ startUrl: config.startUrl, crawlConfig: config.crawl }, async ({ url, parentUrl, depth, index }) => {
      const executed = await executePipelineForUrl(browser, runRoot, { name: `Crawled Page ${index + 1}`, url }, { url, parentUrl, depth }, runId, timestamp, timing, config);
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
      const regressionSummary = buildRegressionSummary(runRoot, config.outputDir, config.assuranceModules.regression);
      writeJson(path.join(runRoot, 'regression-summary.json'), regressionSummary);
      for (const output of outputs) {
        const folder = path.join(runRoot, output.folder);
        writeJson(path.join(folder, 'regression-summary.json'), regressionSummary);
      }
      writeJson(path.join(config.outputDir, 'latest-run.json'), { path: runRoot, runId, timestamp });
      await publishToElasticsearch(config.elasticsearch, summary, targetArtifacts);
      return summary;
  }

    const targets = resolveLinearTargets(config);
    for (const target of targets) {
    const executed = await executePipelineForUrl(browser, runRoot, target, undefined, runId, timestamp, timing, config);
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
    const regressionSummary = buildRegressionSummary(runRoot, config.outputDir, config.assuranceModules.regression);
    writeJson(path.join(runRoot, 'regression-summary.json'), regressionSummary);
    for (const output of outputs) {
      const folder = path.join(runRoot, output.folder);
      writeJson(path.join(folder, 'regression-summary.json'), regressionSummary);
    }
    writeJson(path.join(config.outputDir, 'latest-run.json'), { path: runRoot, runId, timestamp });
    await publishToElasticsearch(config.elasticsearch, summary, targetArtifacts);
    return summary;
  } finally {
    try {
      await browser.close();
    } catch {
      // best effort close
    }
    await timing.persist(runRoot);
  }
}
