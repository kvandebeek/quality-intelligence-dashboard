import type { Page } from 'playwright';
import type { PerformanceMetrics } from '../models/types.js';

export async function collectPerformance(page: Page, url: string): Promise<PerformanceMetrics> {
  const metrics = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    const paints = performance.getEntriesByType('paint');
    const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];

    return {
      navigation: nav ? {
        dnsMs: nav.domainLookupEnd - nav.domainLookupStart,
        tcpMs: nav.connectEnd - nav.connectStart,
        ttfbMs: nav.responseStart - nav.requestStart,
        domContentLoadedMs: nav.domContentLoadedEventEnd - nav.startTime,
        loadEventMs: nav.loadEventEnd - nav.startTime
      } : {},
      paint: Object.fromEntries(paints.map((entry) => [entry.name, entry.startTime])),
      resourceSummary: {
        count: resources.length,
        transferSize: resources.reduce((acc, cur) => acc + cur.transferSize, 0),
        encodedBodySize: resources.reduce((acc, cur) => acc + cur.encodedBodySize, 0),
        decodedBodySize: resources.reduce((acc, cur) => acc + cur.decodedBodySize, 0)
      }
    };
  });

  return { url, ...metrics };
}
