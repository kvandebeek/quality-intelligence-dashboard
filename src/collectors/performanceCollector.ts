import type { Page } from 'playwright';
import type { PerformanceMetrics } from '../models/types.js';

export async function collectPerformance(page: Page, url: string): Promise<PerformanceMetrics> {
  const metrics = await page.evaluate(function collectPerformanceMetrics() {
    const round = (value: number) => Math.round(value);
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    const paints = performance.getEntriesByType('paint');
    const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    const paintMap = Object.fromEntries(paints.map((entry) => [entry.name, round(entry.startTime)]));

    const navigation: Record<string, number> = nav ? {
        dnsMs: round(nav.domainLookupEnd - nav.domainLookupStart),
        tcpMs: round(nav.connectEnd - nav.connectStart),
        ttfbMs: round(nav.responseStart - nav.requestStart),
        domContentLoadedMs: round(nav.domContentLoadedEventEnd - nav.startTime),
        loadEventMs: round(nav.loadEventEnd - nav.startTime)
      } : {};

    return {
      navigation,
      paint: {
        ...paintMap,
        fpMs: paintMap['first-paint'] ?? null,
        fcpMs: paintMap['first-contentful-paint'] ?? null
      },
      resourceSummary: {
        count: resources.length,
        transferSize: round(resources.reduce((acc, cur) => acc + cur.transferSize, 0)),
        encodedBodySize: round(resources.reduce((acc, cur) => acc + cur.encodedBodySize, 0)),
        decodedBodySize: round(resources.reduce((acc, cur) => acc + cur.decodedBodySize, 0))
      }
    };
  });

  return { url, ...metrics };
}
