import { chromium, firefox, webkit, type Browser, type BrowserType, type BrowserContextOptions } from 'playwright';
import { gotoWithConsent } from '../utils/consent/goto-with-consent.js';
import {
  CROSS_BROWSER_PERFORMANCE_WAIT_UNTIL,
  CROSS_BROWSER_RUNS_PER_BROWSER,
  type AppConfig,
  type BrowserName,
  type CrossBrowserIterationTiming,
  type CrossBrowserPerformanceBrowserResult,
  type CrossBrowserPerformanceReport
} from '../models/types.js';

const BROWSER_ORDER: readonly BrowserName[] = ['chromium', 'firefox', 'webkit'];
const BROWSER_TYPES: Record<BrowserName, BrowserType> = { chromium, firefox, webkit };

type StepRunner = <T>(stepName: string, operation: () => Promise<T>) => Promise<T>;

interface NavigationTimingShape {
  duration?: number;
  domContentLoadedEventEnd?: number;
  loadEventEnd?: number;
  responseStart?: number;
  requestStart?: number;
}

const toRoundedMetric = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.round(value);
};

const summarizeDurations = (iterations: CrossBrowserIterationTiming[]): Pick<CrossBrowserPerformanceBrowserResult, 'avgLoadDurationMs' | 'minLoadDurationMs' | 'maxLoadDurationMs'> => {
  const values = iterations
    .map((iteration) => iteration.loadDurationMs)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));

  if (values.length === 0) {
    return { avgLoadDurationMs: null, minLoadDurationMs: null, maxLoadDurationMs: null };
  }

  const avgLoadDurationMs = Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
  return {
    avgLoadDurationMs,
    minLoadDurationMs: Math.min(...values),
    maxLoadDurationMs: Math.max(...values)
  };
};

const buildComparison = (browsers: Record<BrowserName, CrossBrowserPerformanceBrowserResult>): CrossBrowserPerformanceReport['comparison'] => {
  const averages = BROWSER_ORDER
    .map((browserName) => ({ browserName, avg: browsers[browserName].avgLoadDurationMs }))
    .filter((entry): entry is { browserName: BrowserName; avg: number } => typeof entry.avg === 'number');

  if (averages.length === 0) return { fastest: null, slowest: null, diffMsSlowestVsFastest: null };

  const fastest = averages.reduce((best, current) => (current.avg < best.avg ? current : best));
  const slowest = averages.reduce((worst, current) => (current.avg > worst.avg ? current : worst));
  return {
    fastest: fastest.browserName,
    slowest: slowest.browserName,
    diffMsSlowestVsFastest: slowest.avg - fastest.avg
  };
};

async function collectIteration(
  browser: Browser,
  iteration: number,
  url: string,
  consent: AppConfig['consent'],
  contextOptions: BrowserContextOptions
): Promise<CrossBrowserIterationTiming> {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const startedAt = Date.now();

  try {
    await gotoWithConsent(page, url, {
      gotoOptions: { waitUntil: CROSS_BROWSER_PERFORMANCE_WAIT_UNTIL },
      consent
    });

    const navEntry = await page.evaluate(() => {
      const navigationEntry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
      if (!navigationEntry) return null;
      return {
        duration: navigationEntry.duration,
        domContentLoadedEventEnd: navigationEntry.domContentLoadedEventEnd,
        loadEventEnd: navigationEntry.loadEventEnd,
        responseStart: navigationEntry.responseStart,
        requestStart: navigationEntry.requestStart
      };
    }) as NavigationTimingShape | null;

    const fallbackDuration = Math.round(Date.now() - startedAt);
    return {
      iteration,
      loadDurationMs: toRoundedMetric(navEntry?.duration) ?? fallbackDuration,
      domContentLoadedMs: toRoundedMetric(navEntry?.domContentLoadedEventEnd),
      loadEventEndMs: toRoundedMetric(navEntry?.loadEventEnd),
      responseStartMs: toRoundedMetric(navEntry?.responseStart),
      requestStartMs: toRoundedMetric(navEntry?.requestStart)
    };
  } finally {
    await context.close();
  }
}

export async function collectCrossBrowserPerformance(
  url: string,
  consent: AppConfig['consent'],
  stepRunner: StepRunner,
  contextOptions: BrowserContextOptions = {}
): Promise<CrossBrowserPerformanceReport> {
  const browsers: Record<BrowserName, CrossBrowserPerformanceBrowserResult> = {
    chromium: { iterations: [], avgLoadDurationMs: null, minLoadDurationMs: null, maxLoadDurationMs: null },
    firefox: { iterations: [], avgLoadDurationMs: null, minLoadDurationMs: null, maxLoadDurationMs: null },
    webkit: { iterations: [], avgLoadDurationMs: null, minLoadDurationMs: null, maxLoadDurationMs: null }
  };

  for (const browserName of BROWSER_ORDER) {
    await stepRunner(`Artifact: ${browserName} cross-browser-performance`, async () => {
      let browser: Browser | null = null;
      try {
        browser = await BROWSER_TYPES[browserName].launch({ headless: true });
        const iterations: CrossBrowserIterationTiming[] = [];

        for (let iteration = 1; iteration <= CROSS_BROWSER_RUNS_PER_BROWSER; iteration += 1) {
          const iterationResult = await stepRunner(
            `Artifact: ${browserName} cross-browser-performance iteration ${iteration}`,
            async () => collectIteration(browser!, iteration, url, consent, contextOptions)
          );
          iterations.push(iterationResult);
          process.stdout.write(`  PERF ${browserName} iteration=${iteration} loadDurationMs=${iterationResult.loadDurationMs ?? 'null'}\n`);
        }

        const summary = summarizeDurations(iterations);
        browsers[browserName] = { iterations, ...summary };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        browsers[browserName] = {
          iterations: [],
          avgLoadDurationMs: null,
          minLoadDurationMs: null,
          maxLoadDurationMs: null,
          error: message
        };
        process.stderr.write(`Cross-browser performance failed for ${browserName}: ${message}\n`);
      } finally {
        if (browser) await browser.close();
      }
    });
  }

  return {
    meta: {
      url,
      runsPerBrowser: CROSS_BROWSER_RUNS_PER_BROWSER,
      waitUntil: CROSS_BROWSER_PERFORMANCE_WAIT_UNTIL,
      timestamp: new Date().toISOString()
    },
    browsers,
    comparison: buildComparison(browsers)
  };
}
