import type { Browser, BrowserContext, Page, Request, Response } from 'playwright';
import type { AssuranceModulesConfig } from '../models/types.js';

export interface ClientErrorEntry {
  message: string;
  count: number;
  example?: string;
}

export interface ClientErrorsArtifact {
  totalErrors: number;
  severityScore: number;
  uncaughtExceptions: number;
  unhandledRejections: number;
  consoleErrors: number;
  consoleWarnings: number;
  failedRequests: Array<{ url: string; type: string; reason: string }>;
  topErrors: ClientErrorEntry[];
}

export interface UxFrictionArtifact {
  rageClicks: number;
  deadClicks: number;
  longTasks: number;
  layoutShifts: number;
  topSelectors: Array<{ selector: string; count: number }>;
  uxScore: number;
}

export interface MemoryLeaksArtifact {
  available: boolean;
  mode: 'cdp' | 'performance.memory' | 'not_supported';
  initialHeapMB: number | null;
  finalHeapMB: number | null;
  growthMB: number | null;
  leakRisk: 'low' | 'medium' | 'high' | 'unknown';
  evidence: string[];
}

export interface CacheAnalysisArtifact {
  cold: { ttfbMs: number | null; fcpMs: number | null; lcpMs: number | null };
  warm: { ttfbMs: number | null; fcpMs: number | null; lcpMs: number | null };
  improvementPercent: number;
  cacheScore: number;
  poorlyCachedAssets: Array<{ url: string; cacheControl: string; expires: string; etag: string; lastModified: string }>;
}

export interface ThirdPartyResilienceArtifact {
  blockedDomains: string[];
  functionalBreakage: boolean;
  layoutImpact: 'none' | 'low' | 'moderate' | 'high';
  resilienceScore: number;
}

export interface PrivacyAuditArtifact {
  consentBannerDetected: boolean;
  cookiesBeforeConsent: Array<{ name: string; value: string }>;
  insecureCookies: Array<{ name: string; issue: string }>;
  thirdPartyTrackers: string[];
  gdprRisk: 'low' | 'medium' | 'high';
}

export interface RuntimeSecurityArtifact {
  missingHeaders: string[];
  cspStrength: 'none' | 'weak' | 'ok' | 'strong';
  mixedContent: string[];
  inlineScripts: number;
  evalSignals: number;
  securityScore: number;
}

export interface DependencyRiskArtifact {
  domainInventory: Array<{ domain: string; category: string; scripts: number; iframes: number; images: number; fonts: number }>;
  dependencyRiskScore: number;
  topRiskyDependencies: Array<{ domain: string; category: string; score: number }>;
}

interface UxRuntime {
  clicks: Array<{ selector: string; ts: number }>;
  deadClicks: number;
  longTasks: number;
  layoutShifts: number;
}

declare global {
  interface Window {
    __qaUxRuntime?: UxRuntime;
    __qaUnhandledRejections?: string[];
    __qaEvalSignals?: number;
  }
}

const round2 = (value: number): number => Number(value.toFixed(2));
const parseDomain = (url: string): string => {
  try { return new URL(url).hostname; } catch { return ''; }
};

function sameSiteScore(value: string): boolean {
  const lowered = value.toLowerCase();
  return lowered === 'lax' || lowered === 'strict' || lowered === 'none';
}

function classifyDomain(domain: string, rules: Record<string, string>): string {
  for (const [pattern, category] of Object.entries(rules)) {
    if (domain.includes(pattern)) return category;
  }
  return 'unknown';
}

function collectNavMetrics(page: Page): Promise<{ ttfbMs: number | null; fcpMs: number | null; lcpMs: number | null }> {
  return page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    const fcp = performance.getEntriesByName('first-contentful-paint')[0];
    const lcp = performance.getEntriesByType('largest-contentful-paint').at(-1);
    return {
      ttfbMs: nav ? Math.round(nav.responseStart - nav.requestStart) : null,
      fcpMs: fcp ? Math.round(fcp.startTime) : null,
      lcpMs: lcp ? Math.round(lcp.startTime) : null
    };
  });
}

export async function installErrorAndUxObservers(page: Page, config: AssuranceModulesConfig): Promise<void> {
  await page.addInitScript((deadClickWindowMs: number) => {
    window.__qaUnhandledRejections = [];
    window.addEventListener('unhandledrejection', (event) => {
      window.__qaUnhandledRejections?.push(String(event.reason ?? 'unknown rejection'));
    });

    window.__qaEvalSignals = 0;
    const originalEval = window.eval;
    window.eval = function patchedEval(...args: [string]): unknown {
      window.__qaEvalSignals = (window.__qaEvalSignals ?? 0) + 1;
      return originalEval(...args);
    };

    window.__qaUxRuntime = { clicks: [], deadClicks: 0, longTasks: 0, layoutShifts: 0 };
    let lastMutationAt = performance.now();
    const observer = new MutationObserver(() => {
      lastMutationAt = performance.now();
    });
    observer.observe(document, { childList: true, subtree: true, attributes: true });

    document.addEventListener('click', (event) => {
      const target = event.target as Element | null;
      const selector = target ? `${target.tagName.toLowerCase()}${target.id ? `#${target.id}` : ''}` : 'unknown';
      const ts = performance.now();
      window.__qaUxRuntime?.clicks.push({ selector, ts });
      window.setTimeout(() => {
        if (Math.abs(lastMutationAt - ts) > deadClickWindowMs) {
          window.__qaUxRuntime!.deadClicks += 1;
        }
      }, deadClickWindowMs);
    }, { capture: true });

    if ('PerformanceObserver' in window) {
      const perfObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.entryType === 'longtask') window.__qaUxRuntime!.longTasks += 1;
          if (entry.entryType === 'layout-shift') {
            const shifted = entry as PerformanceEntry & { hadRecentInput?: boolean; value?: number };
            if (!shifted.hadRecentInput && (shifted.value ?? 0) > 0) window.__qaUxRuntime!.layoutShifts += 1;
          }
        }
      });
      try { perfObserver.observe({ type: 'longtask', buffered: true }); } catch {}
      try { perfObserver.observe({ type: 'layout-shift', buffered: true }); } catch {}
    }
  }, config.ux.deadClickWindowMs);
}

export async function collectClientErrors(page: Page, config: AssuranceModulesConfig): Promise<ClientErrorsArtifact> {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  let consoleWarningCount = 0;
  const failedRequests: Array<{ url: string; type: string; reason: string }> = [];

  const allowlist = new Set(config.clientErrors.ignoreMessages);
  page.on('pageerror', (error) => {
    if (!allowlist.has(error.message)) pageErrors.push(error.stack ?? error.message);
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (!allowlist.has(text)) consoleErrors.push(text);
    }
    if (msg.type() === 'warning') consoleWarningCount += 1;
  });
  page.on('requestfailed', (request: Request) => {
    failedRequests.push({
      url: request.url(),
      type: request.resourceType(),
      reason: request.failure()?.errorText ?? 'unknown'
    });
  });

  const rejections = await page.evaluate(() => window.__qaUnhandledRejections ?? []);
  const allMessages = [...pageErrors, ...rejections, ...consoleErrors, ...failedRequests.map((f) => `${f.type}:${f.reason}`)];
  const counts = new Map<string, number>();
  for (const message of allMessages) counts.set(message, (counts.get(message) ?? 0) + 1);
  const topErrors = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, config.clientErrors.topErrorsLimit)
    .map(([message, count]) => ({ message, count, example: message.slice(0, 240) }));

  const totalErrors = pageErrors.length + rejections.length + consoleErrors.length + failedRequests.length;
  const severityScore = Math.max(0, 100 - ((pageErrors.length * 6) + (rejections.length * 5) + (consoleErrors.length * 3) + (failedRequests.length * 2)));
  return {
    totalErrors,
    severityScore,
    uncaughtExceptions: pageErrors.length,
    unhandledRejections: rejections.length,
    consoleErrors: consoleErrors.length,
    consoleWarnings: consoleWarningCount,
    failedRequests,
    topErrors
  };
}

export async function collectUxFriction(page: Page, config: AssuranceModulesConfig): Promise<UxFrictionArtifact> {
  const runtime = await page.evaluate(() => window.__qaUxRuntime ?? { clicks: [], deadClicks: 0, longTasks: 0, layoutShifts: 0 });
  const selectorCounts = new Map<string, number>();
  for (const click of runtime.clicks) selectorCounts.set(click.selector, (selectorCounts.get(click.selector) ?? 0) + 1);

  let rageClicks = 0;
  for (let index = 0; index < runtime.clicks.length; index += 1) {
    const start = runtime.clicks[index];
    if (!start) continue;
    let count = 1;
    for (let offset = index + 1; offset < runtime.clicks.length; offset += 1) {
      const current = runtime.clicks[offset];
      if (!current) continue;
      if (current.selector !== start.selector) continue;
      if ((current.ts - start.ts) <= config.ux.rageClickWindowMs) count += 1;
    }
    if (count >= config.ux.rageClickThreshold) rageClicks += 1;
  }

  const topSelectors = [...selectorCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([selector, count]) => ({ selector, count }));
  const uxScore = Math.max(0, 100 - (rageClicks * 7) - (runtime.deadClicks * 5) - (runtime.longTasks * 2) - (runtime.layoutShifts * 3));
  return {
    rageClicks,
    deadClicks: runtime.deadClicks,
    longTasks: runtime.longTasks,
    layoutShifts: runtime.layoutShifts,
    topSelectors,
    uxScore
  };
}

async function readHeapMB(page: Page): Promise<{ available: boolean; mode: MemoryLeaksArtifact['mode']; heapMb: number | null }> {
  try {
    const session = await page.context().newCDPSession(page);
    const metrics = await session.send('Performance.getMetrics');
    const usedSize = metrics.metrics.find((entry) => entry.name === 'JSHeapUsedSize')?.value;
    if (typeof usedSize === 'number') return { available: true, mode: 'cdp', heapMb: round2(usedSize / (1024 * 1024)) };
  } catch {
    // fallback below
  }

  const fallback = await page.evaluate(() => {
    const memory = performance as Performance & { memory?: { usedJSHeapSize: number } };
    if (!memory.memory?.usedJSHeapSize) return null;
    return memory.memory.usedJSHeapSize;
  });

  if (typeof fallback === 'number') return { available: true, mode: 'performance.memory', heapMb: round2(fallback / (1024 * 1024)) };
  return { available: false, mode: 'not_supported', heapMb: null };
}

export async function collectMemoryLeaks(page: Page, config: AssuranceModulesConfig): Promise<MemoryLeaksArtifact> {
  const initial = await readHeapMB(page);
  if (!initial.available) {
    return { available: false, mode: 'not_supported', initialHeapMB: null, finalHeapMB: null, growthMB: null, leakRisk: 'unknown', evidence: ['Memory metrics not supported in this browser/runtime.'] };
  }

  for (let index = 0; index < config.memory.interactionLoops; index += 1) {
    await page.mouse.wheel(0, 500);
    await page.mouse.wheel(0, -500);
    const safeClickable = page.locator('button, [role="button"], a[href]').first();
    if (await safeClickable.count() > 0) {
      await safeClickable.evaluate((element) => {
        element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      });
    }
  }

  const final = await readHeapMB(page);
  const growth = initial.heapMb !== null && final.heapMb !== null ? round2(final.heapMb - initial.heapMb) : null;
  let leakRisk: MemoryLeaksArtifact['leakRisk'] = 'low';
  if (growth !== null && growth > config.memory.growthThresholdMB * 2) leakRisk = 'high';
  else if (growth !== null && growth > config.memory.growthThresholdMB) leakRisk = 'medium';

  const evidence = [
    `mode=${initial.mode}`,
    `interactionLoops=${config.memory.interactionLoops}`,
    growth === null ? 'growth=unknown' : `growthMB=${growth}`
  ];

  return {
    available: true,
    mode: initial.mode,
    initialHeapMB: initial.heapMb,
    finalHeapMB: final.heapMb,
    growthMB: growth,
    leakRisk,
    evidence
  };
}

export async function collectCacheAnalysis(browser: Browser, url: string, config: AssuranceModulesConfig): Promise<CacheAnalysisArtifact> {
  const coldContext = await browser.newContext();
  const coldPage = await coldContext.newPage();
  const seenAssets: CacheAnalysisArtifact['poorlyCachedAssets'] = [];

  coldPage.on('response', async (response: Response) => {
    const request = response.request();
    const type = request.resourceType();
    if (!['script', 'stylesheet', 'image', 'font'].includes(type)) return;
    const headers = response.headers();
    const cacheControl = headers['cache-control'] ?? '';
    const expires = headers.expires ?? '';
    const etag = headers.etag ?? '';
    const lastModified = headers['last-modified'] ?? '';
    if (!cacheControl.includes('max-age') || cacheControl.includes('no-store') || cacheControl.includes('max-age=0')) {
      seenAssets.push({ url: response.url(), cacheControl, expires, etag, lastModified });
    }
  });

  await coldPage.goto(url, { waitUntil: 'load' });
  const cold = await collectNavMetrics(coldPage);
  await coldContext.close();

  const warmContext = await browser.newContext();
  const warmPage = await warmContext.newPage();
  await warmPage.goto(url, { waitUntil: 'load' });
  await warmPage.reload({ waitUntil: 'load' });
  const warm = await collectNavMetrics(warmPage);
  await warmContext.close();

  const coldLcp = cold.lcpMs ?? cold.fcpMs ?? 0;
  const warmLcp = warm.lcpMs ?? warm.fcpMs ?? 0;
  const improvementPercent = coldLcp > 0 ? round2(((coldLcp - warmLcp) / coldLcp) * 100) : 0;
  const cacheScore = Math.max(0, Math.min(100, Math.round(60 + improvementPercent - (seenAssets.length * 2))));

  return { cold, warm, improvementPercent, cacheScore, poorlyCachedAssets: seenAssets.slice(0, 50) };
}

async function runResiliencePass(browser: Browser, url: string, blockedDomains: string[]): Promise<{ errors: number; hasMainContent: boolean; cls: number | null }> {
  const context = await browser.newContext();
  if (blockedDomains.length > 0) {
    await context.route('**/*', (route) => {
      const requestDomain = parseDomain(route.request().url());
      if (blockedDomains.some((domain) => requestDomain.endsWith(domain))) {
        return route.abort('blockedbyclient');
      }
      return route.continue();
    });
  }

  const page = await context.newPage();
  let errors = 0;
  page.on('pageerror', () => {
    errors += 1;
  });
  await page.goto(url, { waitUntil: 'load' });
  const hasMainContent = await page.locator('main, [role="main"], body').first().isVisible();
  const cls = await page.evaluate(() => {
    const total = (performance.getEntriesByType('layout-shift') as Array<PerformanceEntry & { value?: number }>).reduce((sum, entry) => sum + (entry.value ?? 0), 0);
    return Number.isFinite(total) ? Number(total.toFixed(3)) : null;
  });
  await context.close();
  return { errors, hasMainContent, cls };
}

export async function collectThirdPartyResilience(browser: Browser, url: string, thirdPartyDomains: string[], config: AssuranceModulesConfig): Promise<ThirdPartyResilienceArtifact> {
  const blockedDomains = config.thirdPartyResilience.mode === 'all-third-party'
    ? thirdPartyDomains
    : thirdPartyDomains.filter((domain) => config.thirdPartyResilience.defaultBlocklist.some((match) => domain.includes(match)));

  const baseline = await runResiliencePass(browser, url, []);
  const blocked = await runResiliencePass(browser, url, blockedDomains);
  const functionalBreakage = (!blocked.hasMainContent && baseline.hasMainContent) || blocked.errors > baseline.errors;
  const clsDelta = (blocked.cls ?? 0) - (baseline.cls ?? 0);
  const layoutImpact: ThirdPartyResilienceArtifact['layoutImpact'] = clsDelta > 0.25 ? 'high' : clsDelta > 0.1 ? 'moderate' : clsDelta > 0.03 ? 'low' : 'none';
  const resilienceScore = Math.max(0, 100 - (functionalBreakage ? 40 : 0) - (layoutImpact === 'high' ? 35 : layoutImpact === 'moderate' ? 20 : layoutImpact === 'low' ? 10 : 0));

  return { blockedDomains, functionalBreakage, layoutImpact, resilienceScore };
}

export async function collectPrivacyAudit(page: Page, config: AssuranceModulesConfig): Promise<PrivacyAuditArtifact> {
  const trackerSet = new Set<string>();
  const cookieHeaders: string[] = [];
  page.on('request', (request) => {
    const domain = parseDomain(request.url());
    if (config.privacy.trackerDomains.some((tracker) => domain.includes(tracker))) trackerSet.add(domain);
  });
  page.on('response', (response) => {
    const setCookie = response.headers()['set-cookie'];
    if (setCookie) cookieHeaders.push(setCookie);
  });

  const consentBannerDetected = await page.locator(config.privacy.consentSelectors.join(',')).first().isVisible().catch(() => false);
  const cookies = await page.context().cookies();
  const cookieSnapshot = await page.evaluate(() => document.cookie);
  const cookiePairs = cookieSnapshot.split(';').map((entry) => entry.trim()).filter(Boolean).map((entry) => {
    const [name, ...rest] = entry.split('=');
    return { name, value: rest.join('=') };
  });

  const insecureCookies: Array<{ name: string; issue: string }> = [];
  for (const cookie of cookies) {
    if (!cookie.secure) insecureCookies.push({ name: cookie.name, issue: 'missing Secure' });
    if (!sameSiteScore(cookie.sameSite.toString())) insecureCookies.push({ name: cookie.name, issue: 'missing/invalid SameSite' });
  }
  for (const header of cookieHeaders.slice(0, 30)) {
    if (!header.toLowerCase().includes('httponly')) insecureCookies.push({ name: header.split('=')[0] ?? 'unknown', issue: 'missing HttpOnly in Set-Cookie' });
  }

  const riskPoints = (cookiePairs.length > 0 ? 1 : 0) + insecureCookies.length + trackerSet.size;
  const gdprRisk: PrivacyAuditArtifact['gdprRisk'] = riskPoints > 6 ? 'high' : riskPoints > 2 ? 'medium' : 'low';

  return {
    consentBannerDetected,
    cookiesBeforeConsent: cookiePairs,
    insecureCookies,
    thirdPartyTrackers: [...trackerSet],
    gdprRisk
  };
}

export async function collectRuntimeSecurity(page: Page, url: string): Promise<RuntimeSecurityArtifact> {
  const response = await page.goto(url, { waitUntil: 'load' });
  const headers = response?.headers() ?? {};
  const requiredHeaders = ['content-security-policy', 'strict-transport-security', 'x-frame-options', 'referrer-policy', 'permissions-policy', 'x-content-type-options'];
  const missingHeaders = requiredHeaders.filter((name) => !(name in headers));
  const csp = headers['content-security-policy'] ?? '';
  const cspStrength: RuntimeSecurityArtifact['cspStrength'] = !csp ? 'none' : csp.includes("'unsafe-inline'") || csp.includes("'unsafe-eval'") ? 'weak' : csp.includes('default-src') ? 'strong' : 'ok';

  const mixedContent = await page.evaluate(() => {
    if (!location.protocol.startsWith('https')) return [];
    const urls = new Set<string>();
    document.querySelectorAll('script[src],img[src],link[href],iframe[src]').forEach((element) => {
      const candidate = (element.getAttribute('src') ?? element.getAttribute('href') ?? '').trim();
      if (candidate.startsWith('http://')) urls.add(candidate);
    });
    return [...urls];
  });
  const inlineScripts = await page.locator('script:not([src])').count();
  const evalSignals = await page.evaluate(() => window.__qaEvalSignals ?? 0);

  const securityScore = Math.max(0, 100 - (missingHeaders.length * 8) - (mixedContent.length * 4) - (inlineScripts > 0 ? 8 : 0) - (evalSignals * 10));
  return { missingHeaders, cspStrength, mixedContent, inlineScripts, evalSignals, securityScore };
}

export async function collectDependencyRisk(page: Page, firstPartyHost: string, config: AssuranceModulesConfig): Promise<DependencyRiskArtifact> {
  const entries = await page.evaluate(() => {
    const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    return resources.map((resource) => ({ url: resource.name, initiatorType: resource.initiatorType }));
  });

  const inventory = new Map<string, { category: string; scripts: number; iframes: number; images: number; fonts: number }>();
  for (const entry of entries) {
    const domain = parseDomain(entry.url);
    if (!domain || domain === firstPartyHost || domain.endsWith(`.${firstPartyHost}`)) continue;
    const existing = inventory.get(domain) ?? { category: classifyDomain(domain, config.dependencyRisk.categoryRules), scripts: 0, iframes: 0, images: 0, fonts: 0 };
    if (entry.initiatorType === 'script') existing.scripts += 1;
    else if (entry.initiatorType === 'iframe') existing.iframes += 1;
    else if (entry.initiatorType === 'img') existing.images += 1;
    else if (entry.initiatorType === 'css' || entry.initiatorType === 'font') existing.fonts += 1;
    inventory.set(domain, existing);
  }

  const domainInventory = [...inventory.entries()].map(([domain, values]) => ({ domain, ...values }));
  const topRiskyDependencies = domainInventory
    .map((entry) => ({ domain: entry.domain, category: entry.category, score: (entry.scripts * 3) + (entry.iframes * 4) + entry.images + entry.fonts }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
  const dependencyRiskScore = Math.max(0, 100 - topRiskyDependencies.reduce((sum, dep) => sum + Math.min(dep.score, 15), 0));

  return { domainInventory, dependencyRiskScore, topRiskyDependencies };
}

