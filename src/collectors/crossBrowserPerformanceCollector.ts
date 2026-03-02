import { chromium, firefox, webkit, type Browser, type BrowserContextOptions, type BrowserType } from 'playwright';
import { gotoWithConsent } from '../utils/consent/goto-with-consent.js';
import {
  CROSS_BROWSER_DEFAULT_BROWSERS,
  CROSS_BROWSER_PERFORMANCE_WAIT_UNTIL,
  type AppConfig,
  type BrowserName,
  type CrossBrowserConfig,
  type CrossBrowserPerformanceBrowserResult,
  type CrossBrowserPerformanceReport,
  type CrossBrowserUntestedReason,
  type LoadedCrossBrowserConfig
} from '../models/types.js';

const BROWSER_TYPES: Record<BrowserName, BrowserType> = { chromium, firefox, webkit };

type StepRunner = <T>(stepName: string, operation: () => Promise<T>) => Promise<T>;

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function summarizeLoads(browser: BrowserName, values: number[]): CrossBrowserPerformanceBrowserResult {
  const minLoadMs = Math.min(...values);
  const maxLoadMs = Math.max(...values);
  const avgLoadMs = Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
  return { browser, avgLoadMs, minLoadMs, maxLoadMs, samples: values.length };
}

async function collectSingleLoad(
  browser: Browser,
  url: string,
  consent: AppConfig['consent'],
  contextOptions: BrowserContextOptions,
  navigationTimeoutMs: number
): Promise<number> {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const startedAt = Date.now();

  try {
    await gotoWithConsent(page, url, {
      gotoOptions: { waitUntil: CROSS_BROWSER_PERFORMANCE_WAIT_UNTIL, timeout: navigationTimeoutMs },
      consent
    });

    const measured = await page.evaluate(() => {
      const navigationEntry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
      if (!navigationEntry || !Number.isFinite(navigationEntry.duration)) return null;
      return Math.round(navigationEntry.duration);
    });

    return typeof measured === 'number' ? measured : Math.round(Date.now() - startedAt);
  } finally {
    await context.close();
  }
}

function asUntested(config: CrossBrowserConfig, reason: CrossBrowserUntestedReason): CrossBrowserPerformanceReport {
  return {
    category: 'performance',
    crossBrowserPerformance: {
      status: 'untested',
      reason,
      config: {
        enabled: config.enabled,
        browsers: [...config.browsers],
        runs: config.runs
      },
      results: []
    }
  };
}

interface CollectCrossBrowserPerformanceInput {
  url: string;
  consent: AppConfig['consent'];
  headless: boolean;
  loadedConfig: LoadedCrossBrowserConfig;
  stepRunner: StepRunner;
  contextOptions?: BrowserContextOptions;
  defaultNavigationTimeoutMs?: number;
}

export async function collectCrossBrowserPerformance(input: CollectCrossBrowserPerformanceInput): Promise<CrossBrowserPerformanceReport> {
  const {
    url,
    consent,
    headless,
    loadedConfig,
    stepRunner,
    contextOptions = {},
    defaultNavigationTimeoutMs = 30000
  } = input;
  const { config, source } = loadedConfig;

  if (source === 'missing') {
    process.stdout.write('[cross-browser-performance] skipped: missing config/features.json\n');
    return asUntested(config, 'missing_config');
  }
  if (source === 'invalid') {
    process.stdout.write('[cross-browser-performance] skipped: invalid config/features.json\n');
    return asUntested(config, 'invalid_config');
  }
  if (!config.enabled) {
    process.stdout.write('[cross-browser-performance] skipped: disabled via config/features.json\n');
    return asUntested(config, 'disabled');
  }
  if (config.skipIfHeadless && headless) {
    process.stdout.write('[cross-browser-performance] skipped: skipped_headless\n');
    return asUntested(config, 'skipped_headless');
  }

  const browsers = config.browsers.filter((browser): browser is BrowserName => CROSS_BROWSER_DEFAULT_BROWSERS.includes(browser));
  if (browsers.length === 0) {
    process.stdout.write('[cross-browser-performance] skipped: no_browsers_configured\n');
    return asUntested(config, 'no_browsers_configured');
  }

  process.stdout.write(`[cross-browser-performance] running: browsers=${browsers.join(',')} runs=${config.runs}\n`);

  const results: CrossBrowserPerformanceBrowserResult[] = [];
  const timeoutMs = config.navigationTimeoutMs ?? defaultNavigationTimeoutMs;

  for (const browserName of browsers) {
    await stepRunner(`Artifact: ${browserName} cross-browser-performance`, async () => {
      let browser: Browser | null = null;
      try {
        browser = await BROWSER_TYPES[browserName].launch({ headless });
        const samples: number[] = [];

        for (let iteration = 1; iteration <= config.runs; iteration += 1) {
          const sample = await stepRunner(
            `Artifact: ${browserName} cross-browser-performance iteration ${iteration}`,
            async () => collectSingleLoad(browser!, url, consent, contextOptions, timeoutMs)
          );
          samples.push(sample);
          process.stdout.write(`  PERF ${browserName} iteration=${iteration} loadMs=${sample}\n`);
          if (config.cooldownMs && iteration < config.runs) await sleep(config.cooldownMs);
        }

        results.push(summarizeLoads(browserName, samples));
      } finally {
        if (browser) await browser.close();
      }
    });
  }

  return {
    category: 'performance',
    crossBrowserPerformance: {
      status: 'tested',
      reason: null,
      config: {
        enabled: config.enabled,
        browsers: [...config.browsers],
        runs: config.runs
      },
      results
    }
  };
}
