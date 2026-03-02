import type { Page, Response } from 'playwright';
import type { SeoScoreInput } from './types.js';

function hasSoft404Markers(title: string | null, textWordCount: number): boolean {
  const normalized = (title ?? '').toLowerCase();
  if (/404|not found|page not found/.test(normalized)) return true;
  return textWordCount < 30;
}

export async function extractSeoSignals(options: {
  page: Page;
  url: string;
  response: Response | null;
  responseHeaders: Record<string, string>;
  robotsTxtAllows: boolean | null;
  brokenInternalLinksCount: number | null;
  duplicateMetadataSignal: boolean | null;
  webVitals: { lcp: number | null; cls: number | null; inp: number | null };
  pageWeightBytes: number | null;
  requestCount: number | null;
}): Promise<SeoScoreInput> {
  const domSignals = await options.page.evaluate(() => {
    const title = document.querySelector('title')?.textContent?.trim() ?? null;
    const description = document.querySelector('meta[name="description"]')?.getAttribute('content')?.trim() ?? null;
    const canonicalUrl = document.querySelector('link[rel="canonical"]')?.getAttribute('href')?.trim() ?? null;
    const metaRobots = document.querySelector('meta[name="robots"]')?.getAttribute('content')?.trim() ?? null;
    const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content')?.trim() ?? null;
    const ogDescription = document.querySelector('meta[property="og:description"]')?.getAttribute('content')?.trim() ?? null;
    const h1Count = document.querySelectorAll('h1').length;
    const images = [...document.querySelectorAll('img')];
    const imageCount = images.length;
    const imagesWithAltCount = images.filter((img) => {
      const alt = img.getAttribute('alt');
      return alt !== null && alt.trim().length > 0;
    }).length;
    const text = document.body?.innerText ?? '';
    const textWordCount = text.trim().length > 0 ? text.trim().split(/\s+/).length : 0;
    return {
      title,
      description,
      canonicalUrl,
      metaRobots,
      ogTitle,
      ogDescription,
      h1Count,
      imageCount,
      imagesWithAltCount,
      textWordCount
    };
  });

  return {
    url: options.url,
    generatedAt: new Date().toISOString(),
    statusCode: options.response?.status() ?? null,
    redirectChainLength: options.response?.request().redirectedFrom() ? 1 : 0,
    responseHeaders: options.responseHeaders,
    metaRobots: domSignals.metaRobots,
    robotsTxtAllows: options.robotsTxtAllows,
    canonicalUrl: domSignals.canonicalUrl,
    title: domSignals.title,
    description: domSignals.description,
    h1Count: domSignals.h1Count,
    ogTitle: domSignals.ogTitle,
    ogDescription: domSignals.ogDescription,
    imageCount: domSignals.imageCount,
    imagesWithAltCount: domSignals.imagesWithAltCount,
    textWordCount: domSignals.textWordCount,
    hasSoft404Signals: hasSoft404Markers(domSignals.title, domSignals.textWordCount),
    brokenInternalLinksCount: options.brokenInternalLinksCount,
    duplicateMetadataSignal: options.duplicateMetadataSignal,
    webVitals: options.webVitals,
    pageWeightBytes: options.pageWeightBytes,
    requestCount: options.requestCount
  };
}
