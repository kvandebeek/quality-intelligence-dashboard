import { describe, expect, it } from 'vitest';
import { runBfsCrawl } from '../src/core/crawler.js';

describe('runBfsCrawl', () => {
  it('crawls deterministically with domain/depth/duplicate controls', async () => {
    const graph: Record<string, string[]> = {
      'https://example.com/': [
        '/b#fragment',
        '/a',
        'https://external.com/out',
        '/a'
      ],
      'https://example.com/a': ['/a/deep', '/'],
      'https://example.com/b': ['/b/deep'],
      'https://example.com/a/deep': [],
      'https://example.com/b/deep': []
    };

    const result = await runBfsCrawl(
      {
        startUrl: 'https://example.com',
        crawlConfig: {
          enabled: true,
          maxDepth: 2,
          maxPages: 3,
          includeExternalDomains: false,
          allowedDomains: ['example.com']
        }
      },
      async ({ url }) => ({ discoveredHrefs: graph[url] ?? [] })
    );

    expect(result.executedPages.map((page) => page.url)).toEqual([
      'https://example.com/',
      'https://example.com/a',
      'https://example.com/b'
    ]);
    expect(result.totalPagesExecuted).toBe(3);
    expect(result.totalPagesDiscovered).toBe(5);
    expect(result.skippedUrls.some((item) => item.reason === 'duplicate_url')).toBe(true);
    expect(result.skippedUrls.some((item) => item.reason === 'disallowed_domain')).toBe(true);
    expect(result.skippedUrls.some((item) => item.reason === 'max_pages_exceeded')).toBe(true);
  });
});
