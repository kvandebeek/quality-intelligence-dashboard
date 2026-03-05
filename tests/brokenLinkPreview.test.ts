import { describe, expect, it } from 'vitest';
import { buildBrokenLinkFindingId, computeBrokenLinkCrop } from '../src/core/brokenLinkPreview.js';

describe('brokenLinkPreview helpers', () => {
  it('creates deterministic finding IDs', () => {
    const a = buildBrokenLinkFindingId({
      sourcePageUrl: 'https://example.com',
      brokenUrl: 'https://example.com/missing',
      linkText: 'Missing',
      index: 3
    });
    const b = buildBrokenLinkFindingId({
      sourcePageUrl: 'https://example.com',
      brokenUrl: 'https://example.com/missing',
      linkText: 'Missing',
      index: 3
    });
    const c = buildBrokenLinkFindingId({
      sourcePageUrl: 'https://example.com',
      brokenUrl: 'https://example.com/missing',
      linkText: 'Missing',
      index: 4
    });

    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toHaveLength(16);
  });

  it('expands and clamps crop bounds to image dimensions', () => {
    const crop = computeBrokenLinkCrop({ x: 15, y: 20, width: 60, height: 20 }, 100, 90);
    expect(crop).toEqual({ x: 0, y: 0, width: 100, height: 90 });
  });
});
