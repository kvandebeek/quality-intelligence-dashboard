import type { CrawlConfig, CrawlPageMetadata, CrawlSkipReason, CrawlSkipRecord } from '../models/types.js';

const SKIP_REASON: Record<string, CrawlSkipReason> = {
  DUPLICATE: 'duplicate_url',
  DISALLOWED_DOMAIN: 'disallowed_domain',
  INVALID_URL: 'invalid_url',
  DEPTH_EXCEEDED: 'depth_exceeded',
  MAX_PAGES_EXCEEDED: 'max_pages_exceeded'
};

interface CrawlQueueItem {
  url: string;
  parentUrl: string | null;
  depth: number;
}

export interface CrawlExecutionContext {
  url: string;
  parentUrl: string | null;
  depth: number;
  index: number;
}

export interface CrawlExecutionResult {
  discoveredHrefs: string[];
}

export interface CrawlOptions {
  startUrl: string;
  crawlConfig: CrawlConfig;
}

export interface CrawlResult {
  executedPages: CrawlPageMetadata[];
  skippedUrls: CrawlSkipRecord[];
  totalPagesDiscovered: number;
  totalPagesExecuted: number;
}

function normalizeUrl(rawUrl: string, baseUrl: string): string | null {
  try {
    const normalized = new URL(rawUrl, baseUrl);
    normalized.hash = '';
    return normalized.toString();
  } catch {
    return null;
  }
}

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase();
}

function isDomainAllowed(url: string, baseDomain: string, config: CrawlConfig): boolean {
  if (config.includeExternalDomains) {
    return true;
  }

  const hostname = normalizeDomain(new URL(url).hostname);
  const allowedDomains = new Set<string>([
    normalizeDomain(baseDomain),
    ...config.allowedDomains.map((domain) => normalizeDomain(domain))
  ]);

  return allowedDomains.has(hostname);
}

function sortedUnique(values: string[]): string[] {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}

function makeSkip(url: string, parentUrl: string | null, depth: number, reason: CrawlSkipReason): CrawlSkipRecord {
  return { url, parentUrl, depth, reason };
}

export async function runBfsCrawl(
  options: CrawlOptions,
  executePage: (context: CrawlExecutionContext) => Promise<CrawlExecutionResult>
): Promise<CrawlResult> {
  const start = normalizeUrl(options.startUrl, options.startUrl);
  if (!start) {
    throw new Error('Invalid startUrl for crawling.');
  }

  const baseDomain = new URL(start).hostname;
  const queue: CrawlQueueItem[] = [{ url: start, parentUrl: null, depth: 0 }];
  const visited = new Set<string>([start]);
  const skippedUrls: CrawlSkipRecord[] = [];
  const executedPages: CrawlPageMetadata[] = [];
  let cursor = 0;

  while (queue.length > 0) {
    const current = queue.shift() as CrawlQueueItem;

    if (current.depth > options.crawlConfig.maxDepth) {
      skippedUrls.push(makeSkip(current.url, current.parentUrl, current.depth, SKIP_REASON.DEPTH_EXCEEDED));
      continue;
    }

    if (cursor >= options.crawlConfig.maxPages) {
      skippedUrls.push(makeSkip(current.url, current.parentUrl, current.depth, SKIP_REASON.MAX_PAGES_EXCEEDED));
      for (const remaining of queue) {
        skippedUrls.push(
          makeSkip(remaining.url, remaining.parentUrl, remaining.depth, SKIP_REASON.MAX_PAGES_EXCEEDED)
        );
      }
      queue.length = 0;
      break;
    }

    const execution = await executePage({ ...current, index: cursor });
    executedPages.push({ url: current.url, parentUrl: current.parentUrl, depth: current.depth });
    cursor += 1;

    const children = sortedUnique(execution.discoveredHrefs);

    for (const href of children) {
      const normalized = normalizeUrl(href, current.url);
      const nextDepth = current.depth + 1;

      if (!normalized) {
        skippedUrls.push(makeSkip(href, current.url, nextDepth, SKIP_REASON.INVALID_URL));
        continue;
      }

      if (visited.has(normalized)) {
        skippedUrls.push(makeSkip(normalized, current.url, nextDepth, SKIP_REASON.DUPLICATE));
        continue;
      }

      if (nextDepth > options.crawlConfig.maxDepth) {
        skippedUrls.push(makeSkip(normalized, current.url, nextDepth, SKIP_REASON.DEPTH_EXCEEDED));
        continue;
      }

      if (!isDomainAllowed(normalized, baseDomain, options.crawlConfig)) {
        skippedUrls.push(makeSkip(normalized, current.url, nextDepth, SKIP_REASON.DISALLOWED_DOMAIN));
        continue;
      }

      visited.add(normalized);
      queue.push({ url: normalized, parentUrl: current.url, depth: nextDepth });
    }
  }

  return {
    executedPages,
    skippedUrls,
    totalPagesDiscovered: visited.size,
    totalPagesExecuted: executedPages.length
  };
}

export function extractAnchorHrefs(values: Array<string | null>): string[] {
  return values
    .map((value) => value?.trim() ?? '')
    .filter((value) => value.length > 0);
}
