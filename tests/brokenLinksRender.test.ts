import { describe, expect, it } from 'vitest';
import { renderBroken } from '../src/dashboard/app/brokenLinks.js';

describe('renderBroken', () => {
  it('renders headers, deterministic row order, and clickable URL markup', () => {
    const html = renderBroken({
      checkedCount: 8,
      brokenCount: 3,
      redirectChains: 1,
      loops: 0,
      details: [
        { sourcePageUrl: 'https://example.com/b', brokenUrl: 'https://example.com/404-z', status: 404, error: 'timeout' },
        { sourcePageUrl: 'https://example.com/a', brokenUrl: 'https://example.com/404-a', status: 500, errors: ['dns lookup failed'] },
        { sourcePageUrl: 'https://example.com/a', brokenUrl: 'https://example.com/404-a', status: 404, error: 'connection reset' }
      ]
    });

    expect(html).toContain('<th>Source page</th>');
    expect(html).toContain('<th>Broken URL</th>');
    expect(html).toContain('<th>Status</th>');
    expect(html).toContain('<th>Errors</th>');
    expect(html).toContain('<a href="https://example.com/a" target="_blank" rel="noreferrer noopener">https://example.com/a</a>');
    expect(html).toContain('<a href="https://example.com/404-a" target="_blank" rel="noreferrer noopener">https://example.com/404-a</a>');

    const first = html.indexOf('https://example.com/404-a');
    const second = html.indexOf('https://example.com/404-z');
    expect(first).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(-1);
    expect(first).toBeLessThan(second);
  });

  it('shows empty-state and legacy detail note when no modern detail rows can be built', () => {
    const html = renderBroken({
      checkedCount: 2,
      brokenCount: 1,
      details: [{ url: 'https://legacy.example.com', status: 404 }]
    });

    expect(html).toContain('No broken-link detail rows available.');
    expect(html).toContain('Legacy detail format detected; source/broken URL pairs are unavailable.');
  });
});
