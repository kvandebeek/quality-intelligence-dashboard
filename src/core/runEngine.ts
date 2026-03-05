import path from 'node:path';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { chromium, firefox, webkit, type Browser, type BrowserType, type Page, type BrowserContext } from 'playwright';
import { CROSS_BROWSER_PERFORMANCE_FILE, type AppConfig, type CrawlPageMetadata, type RunMetadata, type RunSummary, type RunTarget, type TargetRunArtifacts } from '../models/types.js';
import { collectClientErrors, collectDependencyRisk, collectMemoryLeaks, collectPrivacyAudit, collectRuntimeSecurity, installErrorAndUxObservers } from '../collectors/extensionPackCollector.js';
import { compactTimestamp, stableRunId } from '../utils/time.js';
import { ensureDir, writeJson } from '../utils/file.js';
import { ensureUniqueRunRoot, resolveBatchItemFolderName } from '../utils/artifactPaths.js';
import { collectPerformance } from '../collectors/performanceCollector.js';
import { collectCrossBrowserPerformance } from '../collectors/crossBrowserPerformanceCollector.js';
import { loadCrossBrowserConfig } from '../config/loadCrossBrowserConfig.js';
import { collectAccessibility } from '../collectors/accessibilityCollector.js';
import { publishToElasticsearch } from '../publishers/elasticsearchPublisher.js';
import { extractAnchorHrefs, runBfsCrawl } from './crawler.js';
import { SCHEMA_VERSION, TOOL_VERSION, type ArtifactMeta } from '../models/platform.js';
import { writeValidatedArtifact } from './artifactValidation.js';
import { buildRunIndex, normalizeBrokenLinkDetails, percentileSummary } from './normalization.js';
import { TestTimingTracker } from './testTiming.js';
import { gotoWithConsent } from '../utils/consent/goto-with-consent.js';
import { computeSeoScore } from '../collectors/seoScore/computeSeoScore.js';
import { extractSeoSignals } from '../collectors/seoScore/extractSeoSignals.js';
import { collectUxSuite } from '../collectors/uxSuiteCollector.js';
import { buildBrokenLinkFindingId, captureBrokenLinkPreview, shouldSkipBrokenLinkPreview, type BrokenLinkScreenshot } from './brokenLinkPreview.js';
import { SECURITY_HEADERS, SECURITY_SCAN_SCHEMA_VERSION, classifyMixedContent, normalizeHeaders, parseCspDirectives, parseHstsDirectives, parseSetCookieRedacted, probeRedirectChain, probeTls, summarizeOverall, type HeaderAssessment, type SecurityFinding, type SecurityScanPayloadV2 } from '../collectors/securityScan.js';

const ARTIFACT_FILES = ['performance.json', 'accessibility.json', 'target-summary.json', 'core-web-vitals.json', 'throttled-run.json', 'security-scan.json', 'seo-score.json', 'visual-regression.json', 'broken-links.json', 'third-party-risk.json', 'a11y-beyond-axe.json', 'stability.json', 'memory-profile.json', CROSS_BROWSER_PERFORMANCE_FILE, 'client-errors.json', 'memory-leaks.json', 'privacy-audit.json', 'runtime-security.json', 'dependency-risk.json', 'regression-summary.json', 'ux-overview.json', 'ux-sanity.json', 'ux-layout-stability.json', 'ux-interaction.json', 'ux-click-friction.json', 'ux-keyboard.json', 'ux-overlays.json', 'ux-readability.json', 'ux-forms.json', 'ux-visual-regression.json'] as const;
const FOCUS_TAB_SAMPLE_LIMIT = 14;
const MAX_CONTRAST_SAMPLES_PER_URL = 3;
const MAX_ACCEPTABLE_FCP_MS = 3000;
const FCP_RETRY_ATTEMPTS = 2;
function browserFactory(name: AppConfig['browser']): BrowserType { if (name === 'firefox') return firefox; if (name === 'webkit') return webkit; return chromium; }

type FocusStepSample = { selector: string; accessibleName: string; tagName: string };
type ContrastRegion = {
  boundingBox: { x: number; y: number; width: number; height: number };
  regionScore: number;
  why: string;
  selector: string;
  contrastRatio: number;
  foregroundColor?: string;
  backgroundColor?: string;
  textSizePx?: number;
  textWeight?: string;
  screenshotId?: string;
};

type ContrastReasonCode = 'missing_screenshots' | 'screenshot_capture_failed' | 'page_not_loaded' | 'no_text_nodes_detected' | 'insufficient_color_pairs' | 'algorithm_error' | 'timeout';

type ContrastSimulationResult = {
  status: 'ok' | 'not_available';
  score: number | null;
  reasonCode?: ContrastReasonCode;
  reasonMessage?: string;
  evidence: {
    runId: string;
    testedUrl: string;
    viewport: { width: number; height: number };
    screenshotCount: number;
    stepName: string;
    timingMs: number;
    error?: string;
  };
  samples?: ContrastRegion[];
  screenshotRefs?: string[];
};

async function evaluateFocusStep(page: Page): Promise<{ selector: string; accessibleName: string; tagName: string; role: string | null; ariaModal: string | null; ariaHiddenAncestry: boolean; isVisible: boolean; isEnabled: boolean; boundingBox: { x: number; y: number; width: number; height: number } | null; activeElementHtmlSnippet: string }> {
  return page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    const compactText = (active?.getAttribute('aria-label') ?? active?.textContent ?? active?.getAttribute('title') ?? '').trim().replace(/\s+/g, ' ').slice(0, 180);
    let selector = 'document.body';
    if (active) {
      const id = active.getAttribute('id');
      if (id) {
        selector = `#${id}`;
      } else {
        const testId = active.getAttribute('data-testid');
        if (testId) {
          selector = `[data-testid="${testId}"]`;
        } else {
          const name = active.getAttribute('name');
          if (name) {
            selector = `${active.tagName.toLowerCase()}[name="${name}"]`;
          } else {
            const classes = [...(active.classList || [])].slice(0, 2).join('.');
            const classSegment = classes ? `.${classes}` : '';
            const parent = active.parentElement;
            if (!parent) {
              selector = `${active.tagName.toLowerCase()}${classSegment}`;
            } else {
              const siblings = [...parent.children].filter((child) => child.tagName === active.tagName);
              const nth = siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(active) + 1})` : '';
              selector = `${active.tagName.toLowerCase()}${classSegment}${nth}`;
            }
          }
        }
      }
    }
    const role = active?.getAttribute('role') ?? null;
    const ariaModal = active?.getAttribute('aria-modal') ?? null;
    const ariaHiddenAncestry = Boolean(active?.closest('[aria-hidden="true"]'));
    const rect = active?.getBoundingClientRect();
    const style = active ? window.getComputedStyle(active) : null;
    const isVisible = Boolean(active && rect && rect.width > 0 && rect.height > 0 && style && style.visibility !== 'hidden' && style.display !== 'none');
    const isEnabled = Boolean(active && !active.hasAttribute('disabled') && active.getAttribute('aria-disabled') !== 'true');
    return {
      selector,
      accessibleName: compactText,
      tagName: active?.tagName ?? 'BODY',
      role,
      ariaModal,
      ariaHiddenAncestry,
      isVisible,
      isEnabled,
      boundingBox: rect ? { x: Math.max(0, Math.round(rect.x)), y: Math.max(0, Math.round(rect.y)), width: Math.round(rect.width), height: Math.round(rect.height) } : null,
      activeElementHtmlSnippet: (active?.outerHTML ?? '<body>').replace(/\s+/g, ' ').trim().slice(0, 220)
    };
  });
}



function parseCssColor(value: string | null): [number, number, number] | null {
  if (!value) return null;
  const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function luminanceFromRgb(rgb: [number, number, number]): number {
  const normalized = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return (0.2126 * normalized[0]) + (0.7152 * normalized[1]) + (0.0722 * normalized[2]);
}

function contrastRatio(fg: [number, number, number], bg: [number, number, number]): number {
  const l1 = luminanceFromRgb(fg);
  const l2 = luminanceFromRgb(bg);
  const light = Math.max(l1, l2);
  const dark = Math.min(l1, l2);
  return Number(((light + 0.05) / (dark + 0.05)).toFixed(2));
}

function contrastScoreFromRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0;
  if (ratio >= 7) return 100;
  if (ratio >= 4.5) return 85;
  if (ratio >= 3) return 60;
  return Math.max(10, Math.round((ratio / 3) * 50));
}

export function aggregateContrastSimulationScore(sampleScores: number[]): number | null {
  if (sampleScores.length === 0) return null;
  return Math.round(sampleScores.reduce((sum, score) => sum + score, 0) / sampleScores.length);
}

function sanitizeSlug(url: string): string {
  const value = new URL(url);
  const slug = `${value.hostname}${value.pathname}`.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
  const hash = createHash('sha1').update(url).digest('hex').slice(0, 8);
  return `${slug || 'root'}-${hash}`;
}

type ScrapedPageLink = { href: string; text: string; domIndex: number; selector: string | null };

type BrokenLinkItem = {
  brokenUrl: string;
  sourcePageUrl: string;
  linkText: string;
  selector: string | null;
  findingId: string;
  statusCode: number | null;
  failureReason: '4xx' | '5xx' | 'timeout' | 'dns' | 'invalid_url' | 'request_failed' | 'blocked_by_cors';
  screenshot: BrokenLinkScreenshot;
};

async function scrapePageLinks(page: Page): Promise<ScrapedPageLink[]> {
  const links = await page.locator('a[href]').evaluateAll((anchors) => anchors.map((anchor, index) => {
    const id = anchor.getAttribute('id');
    const testId = anchor.getAttribute('data-testid');
    const ariaLabel = anchor.getAttribute('aria-label');
    const href = anchor.getAttribute('href');
    const text = anchor.textContent?.trim() ?? '';
    const selector = id
      ? `a#${CSS.escape(id)}`
      : testId
        ? `a[data-testid="${CSS.escape(testId)}"]`
        : ariaLabel
          ? `a[aria-label="${CSS.escape(ariaLabel)}"]`
          : typeof href === 'string'
            ? `a[href="${CSS.escape(href)}"]`
            : null;
    return { href, text, domIndex: index, selector };
  }));
  const hrefs = extractAnchorHrefs(links.map((link) => link.href));
  const hrefSet = new Set(hrefs);
  return links
    .filter((link): link is ScrapedPageLink => typeof link.href === 'string' && hrefSet.has(link.href))
    .map((link) => ({ href: link.href, text: link.text.replace(/\s+/g, ' ').trim(), domIndex: link.domIndex, selector: link.selector }));
}

function classifyBrokenLinkFailure(statusCode: number | null, error: unknown): BrokenLinkItem['failureReason'] {
  if (typeof statusCode === 'number') {
    if (statusCode >= 500) return '5xx';
    if (statusCode >= 400) return '4xx';
  }
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  if (message.includes('cors') || message.includes('cross-origin')) return 'blocked_by_cors';
  if (message.includes('timeout') || message.includes('timed out')) return 'timeout';
  if (message.includes('enotfound') || message.includes('eai_again') || message.includes('dns') || message.includes('name not resolved')) return 'dns';
  if (message.includes('invalid url') || message.includes('unsupported protocol')) return 'invalid_url';
  return 'request_failed';
}


function buildHeaderAssessment(name: string, rawValue: string | null): HeaderAssessment {
  const present = Boolean(rawValue);
  if (!present) {
    return { present, rawValue: null, status: 'missing', severity: 'medium', message: `${name} header is missing.`, findings: [{ id: `header-${name}-missing`, title: `${name} missing`, status: 'missing', severity: 'medium', message: `${name} header is missing.`, remediation: `Configure ${name} for this route.` }] };
  }
  return { present, rawValue, status: 'pass', severity: 'info', message: `${name} header is present.`, findings: [{ id: `header-${name}-present`, title: `${name} present`, status: 'pass', severity: 'info', message: `${name} header is present.` }] };
}

function toDomPath(tag: string, id: string | null, index: number): string {
  if (id) return `${tag}#${id}`;
  return `${tag}:nth-of-type(${index + 1})`;
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


function computeMedian(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? null;
  const left = sorted[middle - 1];
  const right = sorted[middle];
  if (left === undefined || right === undefined) return null;
  return Math.round((left + right) / 2);
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
  const requests: Array<{ url: string; resourceType: string; transferSize: number; durationMs: number; initiator: string }> = [];
  const setCookieHeaders: string[] = [];
  page.on('requestfinished', async (request) => {
    const response = await request.response();
    const timingInfo = request.timing();
    const durationMs = Math.max(0, Math.round((timingInfo.responseEnd ?? 0) - (timingInfo.startTime ?? 0)));
    let transferSize = 0;
    try {
      const sizes = await request.sizes();
      transferSize = sizes.responseBodySize;
    } catch {
      transferSize = 0;
    }
    const referer = request.headers()['referer'] ?? 'unknown';
    if (response) {
      try {
        for (const header of await response.headersArray()) {
          if (header.name.toLowerCase() === 'set-cookie') setCookieHeaders.push(header.value);
        }
      } catch {
        // ignore header-array parsing issues
      }
    }
    requests.push({ url: request.url(), resourceType: request.resourceType(), transferSize, durationMs, initiator: referer });
  });

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

    const [basePerformanceMetrics, accessibility, scrapedLinks, coreWebVitals] = await timing.step(testReference, 'Collect core artifacts', async () => {
      const performancePromise = runArtifactStep('Artifact: Performance metrics', async () => collectPerformance(page, target.url));
      const accessibilityPromise = runArtifactStep('Artifact: Accessibility', async () => collectAccessibility(page, target.url));
      const pageLinksPromise = runArtifactStep('Artifact: Page links', async () => scrapePageLinks(page));
      const webVitalsPromise = runArtifactStep('Artifact: Core Web Vitals', async () => collectCoreWebVitals(page));

      return Promise.all([performancePromise, accessibilityPromise, pageLinksPromise, webVitalsPromise]);
    });

    const fcpAttempts: Array<{ attempt: number; fcpMs: number | null; cleanStateRetry: boolean }> = [
      { attempt: 1, fcpMs: basePerformanceMetrics.paint.fcpMs ?? null, cleanStateRetry: false }
    ];

    if ((basePerformanceMetrics.paint.fcpMs ?? null) === null || (basePerformanceMetrics.paint.fcpMs ?? 0) > MAX_ACCEPTABLE_FCP_MS) {
      for (let retryIndex = 0; retryIndex < FCP_RETRY_ATTEMPTS; retryIndex += 1) {
        const cleanContext = await browser.newContext({ serviceWorkers: 'block' });
        await cleanContext.clearCookies();
        await cleanContext.setExtraHTTPHeaders({ 'Cache-Control': 'no-cache', Pragma: 'no-cache' });
        const cleanPage = await cleanContext.newPage();
        try {
          await gotoWithConsent(cleanPage, target.url, { gotoOptions: { waitUntil: 'load' }, consent: config.consent });
          await cleanPage.evaluate(() => {
            try { window.localStorage.clear(); } catch {}
            try { window.sessionStorage.clear(); } catch {}
          });
          const retryPerformance = await collectPerformance(cleanPage, target.url);
          fcpAttempts.push({ attempt: retryIndex + 2, fcpMs: retryPerformance.paint.fcpMs ?? null, cleanStateRetry: true });
        } catch {
          fcpAttempts.push({ attempt: retryIndex + 2, fcpMs: null, cleanStateRetry: true });
        } finally {
          await cleanPage.close();
          await cleanContext.close();
        }
      }
    }

    const measuredAttemptValues = fcpAttempts.map((entry) => entry.fcpMs).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    const medianFcpMs = computeMedian(measuredAttemptValues);
    const slowAttempts = measuredAttemptValues.filter((value) => value > MAX_ACCEPTABLE_FCP_MS).length;
    const fcpIssue = medianFcpMs === null ? true : (medianFcpMs > MAX_ACCEPTABLE_FCP_MS || slowAttempts >= 2);
    const fcpDecisionReason = medianFcpMs === null
      ? 'No successful FCP measurement across attempts; flagged as issue.'
      : `Reported median from ${fcpAttempts.length} attempt(s); ${slowAttempts} over ${MAX_ACCEPTABLE_FCP_MS}ms.`;

    const perfMetrics = {
      ...basePerformanceMetrics,
      paint: {
        ...basePerformanceMetrics.paint,
        fcpMs: medianFcpMs
      },
      fcpAttempts,
      fcpReportedMs: medianFcpMs,
      fcpDecisionReason,
      fcpIssue
    };

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


  const securityHeaders = normalizeHeaders(response?.headers() ?? {});
  const headerAssessments = Object.fromEntries(Object.entries(SECURITY_HEADERS).map(([key, header]) => [key, buildHeaderAssessment(header, securityHeaders[header] ?? null)])) as SecurityScanPayloadV2['headers'];

  const hstsDirectives = headerAssessments.hsts.present && headerAssessments.hsts.rawValue ? parseHstsDirectives(headerAssessments.hsts.rawValue) : {};
  const cspDirectives = headerAssessments.csp.present && headerAssessments.csp.rawValue ? parseCspDirectives(headerAssessments.csp.rawValue) : {};
  const hstsFindings: SecurityFinding[] = [];
  const cspFindings: SecurityFinding[] = [];

  if (headerAssessments.hsts.present) {
    const maxAgeRaw = String(hstsDirectives['max-age'] ?? '');
    const maxAge = Number(maxAgeRaw);
    if (!maxAgeRaw) hstsFindings.push({ id: 'hsts-missing-max-age', title: 'HSTS max-age missing', status: 'missing', severity: 'high', message: 'HSTS is present but max-age is missing.', remediation: 'Set max-age to at least 15552000 seconds.' });
    else if (!Number.isFinite(maxAge) || maxAge < 15552000) hstsFindings.push({ id: 'hsts-low-max-age', title: 'HSTS max-age is low', status: 'weak', severity: 'medium', message: `HSTS max-age (${maxAgeRaw}) is below the conservative threshold of 15552000 seconds.`, remediation: 'Increase max-age to at least 15552000.' });
    if (!hstsDirectives.includesubdomains) hstsFindings.push({ id: 'hsts-no-include-subdomains', title: 'HSTS includeSubDomains missing', status: 'weak', severity: 'low', message: 'HSTS includeSubDomains is recommended but missing.', remediation: 'Add includeSubDomains if subdomains are HTTPS-capable.' });
    if (hstsDirectives.preload) hstsFindings.push({ id: 'hsts-preload-info', title: 'HSTS preload declared', status: 'info', severity: 'low', message: 'Preload is enabled. Ensure all subdomains are HTTPS before preloading.', remediation: 'Review preload eligibility and rollback constraints.' });
  }

  if (headerAssessments.csp.present && headerAssessments.csp.rawValue) {
    const scriptSrc = cspDirectives['script-src'] ?? [];
    const defaultSrc = cspDirectives['default-src'] ?? [];
    if (scriptSrc.includes("'unsafe-inline'")) cspFindings.push({ id: 'csp-unsafe-inline', title: 'CSP allows unsafe-inline', status: 'weak', severity: 'high', message: 'script-src includes unsafe-inline.', evidence: { token: "'unsafe-inline'" }, remediation: 'Use nonces or hashes for inline scripts.' });
    if (scriptSrc.includes("'unsafe-eval'")) cspFindings.push({ id: 'csp-unsafe-eval', title: 'CSP allows unsafe-eval', status: 'weak', severity: 'high', message: 'script-src includes unsafe-eval.', evidence: { token: "'unsafe-eval'" }, remediation: 'Remove unsafe-eval and migrate dynamic code execution.' });
    if (!cspDirectives['default-src']) cspFindings.push({ id: 'csp-missing-default-src', title: 'CSP default-src missing', status: 'missing', severity: 'medium', message: 'default-src is missing from CSP.', remediation: "Add default-src 'self' as baseline." });
    if (defaultSrc.includes('*')) cspFindings.push({ id: 'csp-default-src-wildcard', title: 'CSP default-src is broad', status: 'weak', severity: 'medium', message: 'default-src contains wildcard *.', evidence: { token: '*' }, remediation: 'Restrict default-src to explicit origins.' });
    if (!cspDirectives['object-src']) cspFindings.push({ id: 'csp-missing-object-src', title: 'CSP object-src missing', status: 'weak', severity: 'low', message: "object-src is missing; recommend object-src 'none'.", remediation: "Set object-src 'none'." });
    if (!cspDirectives['base-uri']) cspFindings.push({ id: 'csp-missing-base-uri', title: 'CSP base-uri missing', status: 'weak', severity: 'low', message: 'base-uri is missing.', remediation: "Set base-uri 'self'." });
    if (!cspDirectives['frame-ancestors'] && !headerAssessments.xFrameOptions.present) cspFindings.push({ id: 'csp-missing-frame-ancestors', title: 'Missing frame embedding control', status: 'weak', severity: 'medium', message: 'frame-ancestors is missing and X-Frame-Options is absent.', remediation: "Set frame-ancestors 'none' or appropriate allowlist." });
    if (scriptSrc.includes('*') || scriptSrc.includes('data:')) cspFindings.push({ id: 'csp-broad-script-src', title: 'CSP script-src is broad', status: 'weak', severity: 'medium', message: 'script-src includes broad source token.', evidence: { tokens: scriptSrc.filter((x) => x === '*' || x === 'data:') }, remediation: 'Replace broad tokens with explicit origins.' });
  }

  const referrerFindings: SecurityFinding[] = [];
  if (!headerAssessments.referrerPolicy.present) referrerFindings.push({ id: 'referrer-policy-missing', title: 'Referrer-Policy missing', status: 'missing', severity: 'medium', message: 'Referrer-Policy header is missing.' });
  else if ((headerAssessments.referrerPolicy.rawValue ?? '').toLowerCase().includes('unsafe-url')) referrerFindings.push({ id: 'referrer-policy-unsafe-url', title: 'Referrer-Policy is permissive', status: 'weak', severity: 'medium', message: 'Referrer-Policy uses unsafe-url, which can leak full URLs.' });

  const domScan = await page.evaluate(() => {
    const httpLinks = [...document.querySelectorAll<HTMLAnchorElement>('a[href^="http://"]')].map((a, index) => ({ href: a.href, linkText: (a.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 120), domPath: a.id ? `a#${a.id}` : `a[href^="http://"]:nth-of-type(${index + 1})` }));
    const insecureForms = [...document.querySelectorAll<HTMLFormElement>('form[action^="http://"]')].map((form, index) => ({ action: form.action, method: (form.method || 'get').toLowerCase(), domPath: form.id ? `form#${form.id}` : `form[action^="http://"]:nth-of-type(${index + 1})` }));
    const scripts = [...document.querySelectorAll<HTMLScriptElement>('script[src]')].map((script, index) => ({ src: script.src, integrity: script.integrity || null, selector: script.id ? `script#${script.id}` : `script[src]:nth-of-type(${index + 1})` }));
    return { httpLinks, insecureForms, scripts };
  });

  const mixedContentItems = requests
    .filter((request) => target.url.startsWith('https://') && request.url.startsWith('http://'))
    .map((request) => ({ url: request.url, resourceType: request.resourceType, initiator: request.initiator || 'unknown', classification: classifyMixedContent(request.resourceType) }));
  const mixedCounts = {
    active: mixedContentItems.filter((item) => item.classification === 'active').length,
    passive: mixedContentItems.filter((item) => item.classification === 'passive').length
  };

  const cookieItems = [...new Set(setCookieHeaders)].map((raw) => parseSetCookieRedacted(raw)).sort((a, b) => a.name.localeCompare(b.name));
  const cookieFindings: SecurityFinding[] = [];
  for (const cookie of cookieItems) {
    const lowered = cookie.name.toLowerCase();
    const sessionLike = /session|token|auth|sid/.test(lowered);
    if (target.url.startsWith('https://') && !cookie.secure) {
      cookieFindings.push({ id: `cookie-${cookie.name}-secure`, title: `Cookie ${cookie.name} missing Secure`, status: 'weak', severity: cookie.sameSite === 'None' ? 'high' : 'medium', message: 'Secure attribute is missing on HTTPS.', evidence: { cookie: cookie.name } });
    }
    if (cookie.sameSite === 'None' && !cookie.secure) cookieFindings.push({ id: `cookie-${cookie.name}-samesite-none`, title: `Cookie ${cookie.name} SameSite=None without Secure`, status: 'weak', severity: 'high', message: 'SameSite=None requires Secure.', evidence: { cookie: cookie.name } });
    if (sessionLike && !cookie.httpOnly) cookieFindings.push({ id: `cookie-${cookie.name}-httponly`, title: `Session-like cookie ${cookie.name} missing HttpOnly`, status: 'weak', severity: 'high', message: 'Session-like cookie lacks HttpOnly.', evidence: { cookie: cookie.name } });
  }

  const redirectProbe = await probeRedirectChain(target.url);
  const tlsProbe = await probeTls(target.url);

  const pageOrigin = new URL(target.url).origin;
  const scriptOrigins = domScan.scripts.map((script) => ({ scriptUrl: script.src, origin: new URL(script.src, target.url).origin, loaded: requests.some((request) => request.url === script.src) }));
  const thirdPartyScripts = scriptOrigins.filter((script) => script.origin !== pageOrigin);
  const missingSRI = domScan.scripts
    .filter((script) => new URL(script.src, target.url).origin !== pageOrigin && !script.integrity)
    .map((script) => ({ scriptUrl: script.src, selector: script.selector }));

  const securityFindings: SecurityFinding[] = [
    ...Object.values(headerAssessments).flatMap((header) => header.findings),
    ...hstsFindings,
    ...cspFindings,
    ...referrerFindings,
    ...cookieFindings
  ];
  if (mixedCounts.active > 0) securityFindings.push({ id: 'mixed-content-active', title: 'Active mixed content detected', status: 'weak', severity: 'high', message: `${mixedCounts.active} active HTTP requests loaded on HTTPS page.` });
  if (mixedCounts.passive > 0) securityFindings.push({ id: 'mixed-content-passive', title: 'Passive mixed content detected', status: 'weak', severity: 'medium', message: `${mixedCounts.passive} passive HTTP resources loaded on HTTPS page.` });
  if (target.url.startsWith('https://') && domScan.httpLinks.length > 0) securityFindings.push({ id: 'http-links-on-https', title: 'HTTPS page links to HTTP resources', status: 'info', severity: domScan.httpLinks.length > 5 ? 'medium' : 'low', message: `${domScan.httpLinks.length} HTTP links found in anchor tags.` });
  if (target.url.startsWith('https://') && domScan.insecureForms.length > 0) {
    const hasPost = domScan.insecureForms.some((form) => form.method === 'post');
    securityFindings.push({ id: 'insecure-form-actions', title: 'Forms submit to HTTP endpoints', status: 'weak', severity: hasPost ? 'high' : 'medium', message: `${domScan.insecureForms.length} form actions use HTTP.` });
  }
  if (!redirectProbe.finalUrl.startsWith('https://')) securityFindings.push({ id: 'http-to-https-redirect-missing', title: 'HTTP does not enforce HTTPS redirect', status: 'weak', severity: 'high', message: 'HTTP probe did not end on HTTPS URL.' });
  if (missingSRI.length > 0) securityFindings.push({ id: 'third-party-missing-sri', title: 'Third-party scripts missing SRI', status: 'info', severity: 'low', message: `${missingSRI.length} cross-origin script tags missing integrity attribute.` });

  const securityScan: SecurityScanPayloadV2 = {
    summary: summarizeOverall(securityFindings),
    headers: headerAssessments,
    hstsAnalysis: { directives: hstsDirectives, findings: hstsFindings },
    cspAnalysis: { directives: cspDirectives, findings: cspFindings },
    httpsEnforcement: {
      httpToHttps: { passed: redirectProbe.finalUrl.startsWith('https://'), chain: redirectProbe.chain, finalUrl: redirectProbe.finalUrl, status: redirectProbe.status },
      tls: tlsProbe
    },
    mixedContent: { hasMixedContent: mixedContentItems.length > 0, items: mixedContentItems, counts: mixedCounts },
    httpLinksOnHttpsPage: { items: domScan.httpLinks, count: domScan.httpLinks.length },
    insecureFormActions: { items: domScan.insecureForms, count: domScan.insecureForms.length },
    cookies: {
      items: cookieItems,
      findings: cookieFindings,
      counts: {
        total: cookieItems.length,
        missingSecure: cookieItems.filter((cookie) => !cookie.secure).length,
        missingHttpOnly: cookieItems.filter((cookie) => !cookie.httpOnly).length,
        sameSiteNoneWithoutSecure: cookieItems.filter((cookie) => cookie.sameSite === 'None' && !cookie.secure).length
      }
    },
    thirdParty: { scriptOrigins: thirdPartyScripts, missingSRI, counts: { origins: new Set(thirdPartyScripts.map((script) => script.origin)).size, scripts: thirdPartyScripts.length, missingSri: missingSRI.length } }
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

  const brokenLinksDetails: Array<{ sourcePageUrl: string; brokenUrl: string; status: number; chainLength: number }> = [];
  const brokenLinksItems: BrokenLinkItem[] = [];
  const linkRequestContext = await browser.newContext();
  const sampledLinks = scrapedLinks.slice(0, 50);
  let brokenPreviewCount = 0;
  for (const link of sampledLinks) {
    try {
      const resolved = new URL(link.href, target.url).toString();
      if (new URL(resolved).hostname !== host) continue;

      const req = await linkRequestContext.request.get(resolved, { maxRedirects: 10, timeout: 10000 });
      const statusCode = req.status();
      brokenLinksDetails.push({ sourcePageUrl: target.url, brokenUrl: resolved, status: statusCode, chainLength: 1 });

      if (statusCode >= 400) {
        const canPreview = !shouldSkipBrokenLinkPreview(brokenPreviewCount);
        const preview = canPreview
          ? await captureBrokenLinkPreview(page, targetFolder, {
            sourcePageUrl: target.url,
            brokenUrl: resolved,
            linkText: link.text,
            index: link.domIndex,
            elementSelector: link.selector ?? undefined,
            locator: page.locator('a[href]').nth(link.domIndex)
          })
          : {
            type: 'none' as const,
            path: null,
            thumbnailPath: null,
            elementSelector: link.selector ?? undefined,
            error: 'Preview skipped due to per-page preview limit (50).'
          };
        brokenPreviewCount += 1;
        brokenLinksItems.push({
          brokenUrl: resolved,
          sourcePageUrl: target.url,
          linkText: link.text,
          selector: link.selector,
          findingId: buildBrokenLinkFindingId({ sourcePageUrl: target.url, brokenUrl: resolved, linkText: link.text, index: link.domIndex }),
          statusCode,
          failureReason: classifyBrokenLinkFailure(statusCode, null),
          screenshot: preview
        });
      }
    } catch (error) {
      const rawTarget = typeof link.href === 'string' ? link.href : '';
      const maybeResolved = (() => {
        try {
          return new URL(rawTarget, target.url).toString();
        } catch {
          return rawTarget;
        }
      })();
      const canPreview = !shouldSkipBrokenLinkPreview(brokenPreviewCount);
      const preview = canPreview
        ? await captureBrokenLinkPreview(page, targetFolder, {
          sourcePageUrl: target.url,
          brokenUrl: maybeResolved,
          linkText: link.text,
          index: link.domIndex,
          elementSelector: link.selector ?? undefined,
          locator: page.locator('a[href]').nth(link.domIndex)
        })
        : {
          type: 'none' as const,
          path: null,
          thumbnailPath: null,
          elementSelector: link.selector ?? undefined,
          error: 'Preview skipped due to per-page preview limit (50).'
        };
      brokenPreviewCount += 1;
      brokenLinksItems.push({
        brokenUrl: maybeResolved,
        sourcePageUrl: target.url,
        linkText: link.text,
        selector: link.selector,
        findingId: buildBrokenLinkFindingId({ sourcePageUrl: target.url, brokenUrl: maybeResolved, linkText: link.text, index: link.domIndex }),
        statusCode: null,
        failureReason: classifyBrokenLinkFailure(null, error),
        screenshot: preview
      });
    }
  }
  await linkRequestContext.close();

  const normalizedBrokenLinksDetails = normalizeBrokenLinkDetails(brokenLinksDetails);
  const brokenLinks = {
    summary: {
      checked: normalizedBrokenLinksDetails.length,
      broken: brokenLinksItems.length,
      redirectChains: normalizedBrokenLinksDetails.filter((item) => item.chainLength > 1).length,
      loops: 0
    },
    details: normalizedBrokenLinksDetails,
    items: brokenLinksItems
  };

  const robotsTxtAllows = await isPathAllowedByRobots(browser, target.url);
  const seoSignals = await extractSeoSignals({
    page: seoPage,
    url: target.url,
    response: seoResponse.response,
    responseHeaders: seoResponse.response?.headers() ?? {},
    robotsTxtAllows,
    brokenInternalLinksCount: brokenLinks.summary.broken,
    duplicateMetadataSignal: null,
    webVitals: { lcp: coreWebVitals.lcp, cls: coreWebVitals.cls, inp: coreWebVitals.inp },
    pageWeightBytes: perfMetrics.resourceSummary.transferSize,
    requestCount: perfMetrics.resourceSummary.count
  });
  const seoScore = computeSeoScore(seoSignals);
  await seoContext.close();

  const focusCheck = await browser.newPage().then(async (checkPage) => {
    const contrastStepName = 'artifact.accessibility_beyond_axe.contrast_simulation';
    const startedAt = Date.now();
    let viewport = { width: 1366, height: 768 };
    let screenshotCount = 0;
    const screenshotRefs: string[] = [];
    const serializeError = (error: unknown): string => {
      const raw = error instanceof Error ? error.message : String(error);
      return raw.replace(/https?:\/\/[^\s]+/gi, '[redacted-url]').slice(0, 240);
    };
    const notAvailableResult = (reasonCode: ContrastReasonCode, reasonMessage: string, stepName: string, error?: unknown): ContrastSimulationResult => {
      const evidence: ContrastSimulationResult['evidence'] = {
        runId,
        testedUrl: target.url,
        viewport,
        screenshotCount,
        stepName,
        timingMs: Date.now() - startedAt
      };
      if (error) evidence.error = serializeError(error);
      process.stderr.write(`[${contrastStepName}] status=not_available reasonCode=${reasonCode} testedUrl=${target.url} runId=${runId} step=${stepName}${evidence.error ? ` error=${evidence.error}` : ''}\n`);
      return { status: 'not_available', score: null, reasonCode, reasonMessage, evidence, screenshotRefs };
    };

    try {
      await checkPage.setViewportSize(viewport);
      const gotoResult = await gotoWithConsent(checkPage, target.url, { gotoOptions: { waitUntil: 'load' }, consent: config.consent });
      if (!gotoResult.response) {
        await checkPage.close();
        return {
          keyboardReachable: false,
          possibleFocusTrap: false,
          contrastSimulationScore: null as number | null,
          contrastSimulationResult: notAvailableResult('page_not_loaded', 'Page did not return a successful response during contrast simulation.', contrastStepName)
        };
      }

      const a11yArtifactDir = path.join(targetFolder, 'a11y-beyond-axe');
      ensureDir(a11yArtifactDir);

      const tabSequence: FocusStepSample[] = [];
      const selectorHits = new Map<string, number>();
      let trapDetectedAt = -1;
      let trapDetectionSample: Awaited<ReturnType<typeof evaluateFocusStep>> | null = null;
      for (let step = 0; step < FOCUS_TAB_SAMPLE_LIMIT; step += 1) {
        await checkPage.keyboard.press('Tab');
        const sample = await evaluateFocusStep(checkPage);
        tabSequence.push({ selector: sample.selector, accessibleName: sample.accessibleName, tagName: sample.tagName });
        selectorHits.set(sample.selector, (selectorHits.get(sample.selector) ?? 0) + 1);
        if ((selectorHits.get(sample.selector) ?? 0) >= 3 && trapDetectedAt === -1) {
          trapDetectedAt = step;
          trapDetectionSample = sample;
        }
      }

      const keyboardReachable = tabSequence.some((step) => step.selector !== 'document.body');
      const repeated = [...selectorHits.entries()].sort((a, b) => b[1] - a[1]).filter((entry) => entry[1] > 1);
      const possibleFocusTrap = repeated.length > 0 && repeated[0]![1] >= 3;
      const trapCandidates = [] as Array<Record<string, unknown>>;

      if (possibleFocusTrap && trapDetectionSample) {
        const screenshotId = 'focus-trap-candidate-1.png';
        const screenshotPath = path.join(a11yArtifactDir, screenshotId);
        await checkPage.screenshot({ path: screenshotPath, fullPage: false });
        screenshotCount += 1;
        screenshotRefs.push(`a11y-beyond-axe/${screenshotId}`);
        const repeatPatternDetected = repeated.slice(0, 2).map((entry) => `${entry[0]} (${entry[1]} times)`).join(' ↔ ');
        trapCandidates.push({
          url: checkPage.url(),
          timestamp: new Date().toISOString(),
          stepContext: `after tabbing ${trapDetectedAt + 1} times`,
          trapCandidate: {
            selector: trapDetectionSample.selector,
            role: trapDetectionSample.role,
            ariaModal: trapDetectionSample.ariaModal,
            ariaHiddenAncestry: trapDetectionSample.ariaHiddenAncestry,
            isVisible: trapDetectionSample.isVisible,
            isEnabled: trapDetectionSample.isEnabled
          },
          evidence: {
            tabSequenceSample: tabSequence.slice(-8),
            repeatPatternDetected: repeatPatternDetected || 'Repeated focus observed on same element',
            activeElementHtmlSnippet: trapDetectionSample.activeElementHtmlSnippet,
            screenshotId,
            screenshotPath: `a11y-beyond-axe/${screenshotId}`
          },
          reproSteps: `Load page, then press Tab ${trapDetectedAt + 1} times until focus repeatedly returns to ${trapDetectionSample.selector}.`
        });
      }

      viewport = checkPage.viewportSize() ?? viewport;
      const pageMetrics = await checkPage.evaluate(() => ({
        scrollHeight: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
        deviceScaleFactor: window.devicePixelRatio || 1,
        readyState: document.readyState
      }));
      if (pageMetrics.readyState !== 'complete' && pageMetrics.readyState !== 'interactive') {
        await checkPage.close();
        return {
          keyboardReachable,
          possibleFocusTrap,
          possibleFocusTrapDetails: trapCandidates.length > 0 ? { candidates: trapCandidates } : undefined,
          contrastSimulationScore: null as number | null,
          contrastSimulationResult: notAvailableResult('page_not_loaded', `Page readyState was ${pageMetrics.readyState}.`, `${contrastStepName}.ready_state`)
        };
      }

      const maxScroll = Math.max(0, pageMetrics.scrollHeight - viewport.height);
      const scrollSamples = [0, Math.round(maxScroll / 2), maxScroll].slice(0, MAX_CONTRAST_SAMPLES_PER_URL);
      const contrastSamples: Array<Record<string, unknown>> = [];
      const sampleScores: number[] = [];
      const topSamples: ContrastRegion[] = [];

      for (let index = 0; index < scrollSamples.length; index += 1) {
        const scrollY = scrollSamples[index] ?? 0;
        await checkPage.evaluate((y) => window.scrollTo(0, y), scrollY);
        const regionStats = await checkPage.evaluate(() => {
          const nodes = [...document.querySelectorAll('body *')].filter((element) => {
            const html = element as HTMLElement;
            const rect = html.getBoundingClientRect();
            if (rect.width < 20 || rect.height < 12) return false;
            const style = window.getComputedStyle(html);
            return style.visibility !== 'hidden' && style.display !== 'none' && Number.parseFloat(style.fontSize || '0') >= 11 && (html.innerText || '').trim().length > 0;
          }).slice(0, 40);
          return nodes.map((element) => {
            const html = element as HTMLElement;
            const style = window.getComputedStyle(html);
            const rect = html.getBoundingClientRect();
            return {
              selector: html.id ? `#${html.id}` : `${html.tagName.toLowerCase()}${html.classList.length ? `.${[...html.classList].slice(0, 2).join('.')}` : ''}`,
              color: style.color,
              backgroundColor: style.backgroundColor,
              textSizePx: Number.parseFloat(style.fontSize || '0') || null,
              textWeight: style.fontWeight || null,
              box: { x: Math.max(0, Math.round(rect.x)), y: Math.max(0, Math.round(rect.y)), width: Math.round(rect.width), height: Math.round(rect.height) }
            };
          });
        });

        if (!regionStats.length) {
          continue;
        }

        const screenshotId = `contrast-sample-${index + 1}.png`;
        const screenshotPath = path.join(a11yArtifactDir, screenshotId);
        try {
          await checkPage.screenshot({ path: screenshotPath, fullPage: false });
        } catch (error) {
          await checkPage.close();
          return {
            keyboardReachable,
            possibleFocusTrap,
            possibleFocusTrapDetails: trapCandidates.length > 0 ? { candidates: trapCandidates } : undefined,
            contrastSimulationScore: null as number | null,
            contrastSimulationResult: notAvailableResult('screenshot_capture_failed', `Failed to capture screenshot ${screenshotId}.`, `${contrastStepName}.screenshot`, error)
          };
        }
        screenshotCount += 1;
        screenshotRefs.push(`a11y-beyond-axe/${screenshotId}`);

        const measuredRegions: ContrastRegion[] = regionStats.flatMap((region) => {
          const fg = parseCssColor(region.color);
          const bg = parseCssColor(region.backgroundColor);
          if (!fg || !bg) return [];
          const ratio = contrastRatio(fg, bg);
          const regionScore = contrastScoreFromRatio(ratio);
          const why = ratio < 3 ? 'Text blends into background under low-contrast simulation' : ratio < 4.5 ? 'Contrast is borderline for normal text' : 'Acceptable contrast in sampled region';
          return [{
            boundingBox: region.box,
            regionScore,
            why,
            selector: region.selector,
            contrastRatio: ratio,
            foregroundColor: region.color,
            backgroundColor: region.backgroundColor,
            textSizePx: region.textSizePx ?? undefined,
            textWeight: region.textWeight ?? undefined,
            screenshotId
          }];
        }).sort((a, b) => a.regionScore - b.regionScore).slice(0, 6);

        if (!measuredRegions.length) continue;

        topSamples.push(...measuredRegions);
        const averageScore = Math.round(measuredRegions.reduce((sum, region) => sum + region.regionScore, 0) / measuredRegions.length);
        sampleScores.push(averageScore);
        contrastSamples.push({
          runId,
          testedUrl: target.url,
          viewport,
          deviceScaleFactor: pageMetrics.deviceScaleFactor,
          scrollY,
          screenshotId,
          thumbnailId: screenshotId,
          screenshotPath: `a11y-beyond-axe/${screenshotId}`,
          measuredRegions,
          recommendations: measuredRegions.some((region) => region.contrastRatio < 3)
            ? ['Increase text/background luminance difference.', 'Avoid mid-gray text on gray backgrounds.', 'Add solid background behind text over images.']
            : ['Maintain current contrast levels and verify interactive states.']
        });
      }

      if (screenshotCount === 0) {
        await checkPage.close();
        return {
          keyboardReachable,
          possibleFocusTrap,
          possibleFocusTrapDetails: trapCandidates.length > 0 ? { candidates: trapCandidates } : undefined,
          contrastSimulationScore: null as number | null,
          contrastSimulationResult: notAvailableResult('missing_screenshots', 'No screenshots were captured for contrast simulation.', `${contrastStepName}.screenshots`)
        };
      }

      if (contrastSamples.length === 0) {
        await checkPage.close();
        return {
          keyboardReachable,
          possibleFocusTrap,
          possibleFocusTrapDetails: trapCandidates.length > 0 ? { candidates: trapCandidates } : undefined,
          contrastSimulationScore: null as number | null,
          contrastSimulationResult: notAvailableResult('no_text_nodes_detected', 'No visible text nodes were detected for contrast sampling.', `${contrastStepName}.nodes`)
        };
      }

      if (sampleScores.length < 1) {
        await checkPage.close();
        return {
          keyboardReachable,
          possibleFocusTrap,
          possibleFocusTrapDetails: trapCandidates.length > 0 ? { candidates: trapCandidates } : undefined,
          contrastSimulationScore: null as number | null,
          contrastSimulationResult: notAvailableResult('insufficient_color_pairs', 'Color pairs were detected but no valid contrast ratios could be computed.', `${contrastStepName}.ratios`)
        };
      }

      const contrastSimulationScore = aggregateContrastSimulationScore(sampleScores) as number;
      const contrastSimulationResult: ContrastSimulationResult = {
        status: 'ok',
        score: contrastSimulationScore,
        evidence: {
          runId,
          testedUrl: target.url,
          viewport,
          screenshotCount,
          stepName: contrastStepName,
          timingMs: Date.now() - startedAt
        },
        samples: topSamples.sort((a, b) => a.regionScore - b.regionScore).slice(0, 12),
        screenshotRefs
      };

      await checkPage.close();
      return {
        keyboardReachable,
        possibleFocusTrap,
        possibleFocusTrapDetails: trapCandidates.length > 0 ? { candidates: trapCandidates } : undefined,
        contrastSimulationScore,
        contrastSimulationScoreReason: null as string | null,
        contrastSimulationResult,
        contrastSimulationDetails: {
          method: {
            simulations: ['low-contrast approximation'],
            sampleStrategy: { viewport, scrollPositions: scrollSamples, samplesPerUrl: scrollSamples.length },
            measurements: ['foreground/background color contrast ratio proxy', 'luminance delta proxy from computed styles'],
            scopedToRun: { runId, testedUrl: target.url }
          },
          findings: contrastSamples
        }
      };
    } catch (error) {
      await checkPage.close();
      return {
        keyboardReachable: false,
        possibleFocusTrap: false,
        contrastSimulationScore: null as number | null,
        contrastSimulationResult: notAvailableResult(error instanceof Error && /timeout/i.test(error.message) ? 'timeout' : 'algorithm_error', 'Unable to evaluate keyboard contrast simulation on this page.', contrastStepName, error)
      };
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

  const artifact: TargetRunArtifacts = { target, performance: perfMetrics, accessibility };

  writeValidatedArtifact(path.join(targetFolder, 'performance.json'), 'performance', meta, perfMetrics);
  writeValidatedArtifact(path.join(targetFolder, 'accessibility.json'), 'accessibility', meta, accessibility);
  writeValidatedArtifact(path.join(targetFolder, 'core-web-vitals.json'), 'coreWebVitals', meta, coreWebVitals);
  writeValidatedArtifact(path.join(targetFolder, 'throttled-run.json'), 'throttled', meta, { available: throttledLoadMs !== null, baselineLoadMs, throttledLoadMs, degradationFactor: baselineLoadMs && throttledLoadMs ? Number((throttledLoadMs / baselineLoadMs).toFixed(2)) : null });
  writeValidatedArtifact(path.join(targetFolder, 'security-scan.json'), 'security', { ...meta, schemaVersion: SECURITY_SCAN_SCHEMA_VERSION }, securityScan);
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
  const privacyAudit = config.assuranceModules.enabled.privacyAudit ? await timing.step(testReference, 'Extension: Privacy audit', async () => collectPrivacyAudit(page, config.assuranceModules)) : { consentBannerDetected: false, cookiesBeforeConsent: [], insecureCookies: [], thirdPartyTrackers: [], gdprRisk: 'low' };
  const runtimeSecurity = config.assuranceModules.enabled.runtimeSecurity ? await timing.step(testReference, 'Extension: Runtime security', async () => collectRuntimeSecurity(page, target.url)) : { missingHeaders: [], cspStrength: 'none', mixedContent: [], inlineScripts: 0, evalSignals: 0, securityScore: 100 };
  const dependencyRisk = config.assuranceModules.enabled.dependencyRisk ? await timing.step(testReference, 'Extension: Dependency risk', async () => collectDependencyRisk(page, parseDomain(target.url), config.assuranceModules)) : { domainInventory: [], dependencyRiskScore: 100, topRiskyDependencies: [] };

  writeValidatedArtifact(path.join(targetFolder, 'client-errors.json'), 'clientErrors', meta, clientErrors);
  writeValidatedArtifact(path.join(targetFolder, 'memory-leaks.json'), 'memoryLeaks', meta, memoryLeaks);
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
    return {
      artifact,
      output: { targetName: target.name, folder: path.relative(runRoot, targetFolder), files: [...ARTIFACT_FILES], crawl },
      hrefs: scrapedLinks.map((link) => link.href),
      extensionScores: { clientErrors: clientErrors.severityScore, memory: memoryLeaks.growthMB, privacy: privacyAudit.gdprRisk, runtimeSecurity: runtimeSecurity.securityScore, dependency: dependencyRisk.dependencyRiskScore }
    };
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
  const runId = config.name
    ? resolveBatchItemFolderName(config.name, config.startUrl)
    : stableRunId(timestamp, config.browser, config.iteration);
  const metadata: RunMetadata = { runId, timestamp, browser: config.browser, environment: config.environment, iteration: config.iteration, name: config.name, startUrl: config.startUrl, targets: config.targets };
  const runRoot = (() => {
    if (!config.name) {
      return ensureUniqueRunRoot(config.outputDir, runId);
    }

    const namedFolder = resolveBatchItemFolderName(config.name, config.startUrl);
    const outputLeaf = path.basename(path.normalize(config.outputDir));

    if (outputLeaf === namedFolder) {
      return ensureUniqueRunRoot(path.dirname(path.normalize(config.outputDir)), namedFolder);
    }

    return ensureUniqueRunRoot(config.outputDir, namedFolder);
  })();
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
