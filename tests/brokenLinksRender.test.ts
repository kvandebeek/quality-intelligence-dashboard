import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeBrokenLinksReport, renderBroken } from '../src/dashboard/app/brokenLinks.js';

describe('renderBroken', () => {
  it('renders deterministic table with summary, filter, and clickable links', () => {
    const html = renderBroken({
      checkedCount: 8,
      brokenCount: 22,
      redirectChains: 1,
      loops: 0,
      details: [
        { sourcePageUrl: 'https://example.com/c', brokenUrl: 'https://example.com/ok', status: 200, error: 'none' },
        { sourcePageUrl: 'https://example.com/b', brokenUrl: 'https://example.com/404-z', status: 404, error: 'timeout' },
        { sourcePageUrl: 'https://example.com/a', brokenUrl: 'https://example.com/404-a', status: 500, errors: ['dns lookup failed'] },
        { sourcePageUrl: 'https://example.com/a', brokenUrl: 'https://example.com/404-a', status: 404, error: 'connection reset' }
      ]
    });

    expect(html).toContain('Broken links: 2 across 2 pages');
    expect(html).toContain('<strong>2</strong>');
    expect(html).toContain('Filter broken URL');
    expect(html).toContain('<th>Source page</th>');
    expect(html).toContain('<th>Broken URL</th>');
    expect(html).toContain('<th>Status</th>');
    expect(html).toContain('<th>Failure reason</th>');
    expect(html).toContain('<a href="https://example.com/a" target="_blank" rel="noreferrer noopener">https://example.com/a</a>');
    expect(html).toContain('<a href="https://example.com/404-a" target="_blank" rel="noreferrer noopener">https://example.com/404-a</a>');

    const first = html.indexOf('https://example.com/404-a');
    const second = html.indexOf('https://example.com/404-z');
    expect(first).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(-1);
    expect(first).toBeLessThan(second);
    expect(html).not.toContain('https://example.com/ok');
  });

  it('supports drifted artifact shapes via parser normalization', () => {
    const fixturePath = path.join(process.cwd(), 'tests/fixtures/broken-links/multi-shape.json');
    const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

    const normalized = normalizeBrokenLinksReport(fixture);

    expect(normalized.rows).toHaveLength(2);
    expect(normalized.rows[0]).toMatchObject({
      sourcePageUrl: 'https://example.com/source-a',
      brokenUrl: 'https://example.com/missing-a',
      status: 404,
      linkText: 'Read more'
    });
    expect(normalized.rows[1]).toMatchObject({
      sourcePageUrl: 'https://example.com/source-b',
      brokenUrl: 'https://example.com/missing-b',
      selector: 'a.hero-link',
      reason: 'DNS failure'
    });
  });

  it('derives failure reason from status codes when error text is missing', () => {
    const normalized = normalizeBrokenLinksReport({
      details: [
        { sourcePageUrl: 'https://example.com', brokenUrl: 'https://example.com/not-found', status: 404 },
        { sourcePageUrl: 'https://example.com', brokenUrl: 'https://example.com/forbidden', status: 403 },
        { sourcePageUrl: 'https://example.com', brokenUrl: 'https://example.com/server-error', status: 500 }
      ]
    });

    expect(normalized.rows.map((row) => row.reason)).toEqual(['forbidden', 'not_found', 'server_error']);
  });

  it('shows explicit empty state when artifact is missing', () => {
    const html = renderBroken({}, { artifactMissing: true });
    expect(html).toContain('No broken links artifact found in this run');
  });
});
