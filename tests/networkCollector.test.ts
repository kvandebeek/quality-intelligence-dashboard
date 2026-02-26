import { describe, expect, it } from 'vitest';
import { recommendNetworkOptimizations } from '../src/collectors/networkCollector.js';

describe('recommendNetworkOptimizations', () => {
  it('returns recommendations for slow and large resources', () => {
    const output = recommendNetworkOptimizations([
      { url: 'a', method: 'GET', status: 200, resourceType: 'text/javascript', transferSize: 400000, durationMs: 1500, fromCache: false }
    ]);

    expect(output.length).toBeGreaterThan(0);
    expect(output.map((x) => x.id)).toContain('net-large-assets');
  });
});
