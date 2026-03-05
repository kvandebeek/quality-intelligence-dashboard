import { describe, expect, it } from 'vitest';
import { aggregateBrokenLinkDetails } from '../src/dashboard/app/brokenLinks.js';

describe('broken link aggregation', () => {
  it('deduplicates by sourcePageUrl+brokenUrl and keeps deterministic sort order', () => {
    const fixture = [
      { sourcePageUrl: 'https://example.com/b', brokenUrl: 'https://example.com/404-z', status: 404, error: 'timeout' },
      { sourcePageUrl: 'https://example.com/a', brokenUrl: 'https://example.com/404-a', status: 500, error: 'connection reset' },
      { sourcePageUrl: 'https://example.com/a', brokenUrl: 'https://example.com/404-a', status: 404, errors: ['dns lookup failed', 'connection reset'] },
      { sourcePageUrl: 'https://example.com/a', brokenUrl: 'https://example.com/404-b', status: 410, error: 'gone' },
      { sourcePageUrl: 'https://example.com/b', brokenUrl: 'https://example.com/404-z', status: 503, error: 'upstream unavailable' }
    ];

    const rows = aggregateBrokenLinkDetails(fixture);

    expect(rows).toHaveLength(3);
    expect(rows.map((row) => `${row.sourcePageUrl} -> ${row.brokenUrl}`)).toEqual([
      'https://example.com/a -> https://example.com/404-a',
      'https://example.com/a -> https://example.com/404-b',
      'https://example.com/b -> https://example.com/404-z'
    ]);
    expect(rows[0]).toEqual({
      sourcePageUrl: 'https://example.com/a',
      brokenUrl: 'https://example.com/404-a',
      status: 500,
      errors: ['connection reset', 'dns lookup failed'],
      occurrences: 2
    });
    expect(rows[2]).toEqual({
      sourcePageUrl: 'https://example.com/b',
      brokenUrl: 'https://example.com/404-z',
      status: 503,
      errors: ['timeout', 'upstream unavailable'],
      occurrences: 2
    });
  });
});
