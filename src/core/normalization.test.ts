import { describe, expect, it } from 'vitest';
import { normalizeBrokenLinkDetails } from './normalization.js';

describe('normalizeBrokenLinkDetails', () => {
  it('normalizes urls, removes hashes, deduplicates by composite key, and sorts deterministically', () => {
    const input = [
      { sourcePageUrl: ' https://example.com/b ', brokenUrl: '/a#top ', status: 404, chainLength: 1 },
      { sourcePageUrl: 'https://example.com/a', brokenUrl: 'https://example.com/z#frag', status: 404, chainLength: 1 },
      { sourcePageUrl: 'https://example.com/b#anchor', brokenUrl: 'https://example.com/a#hash', status: 500, chainLength: 2 },
      { sourcePageUrl: 'https://example.com/b', brokenUrl: 'https://example.com/a', status: 404, chainLength: 1 }
    ];

    expect(normalizeBrokenLinkDetails(input)).toEqual([
      { sourcePageUrl: 'https://example.com/a', brokenUrl: 'https://example.com/z', status: 404, chainLength: 1 },
      { sourcePageUrl: 'https://example.com/b', brokenUrl: 'https://example.com/a', status: 404, chainLength: 1 }
    ]);
  });
});
