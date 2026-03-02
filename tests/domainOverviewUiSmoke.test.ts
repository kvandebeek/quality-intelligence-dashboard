import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('domain overview UI smoke', () => {
  it('includes default domain overview nav and 8 overview tiles', () => {
    const file = fs.readFileSync(path.resolve('src/dashboard/app/app.js'), 'utf8');
    expect(file).toContain('Domain overview');
    expect(file).toContain("selectedView: 'domain-overview'");
    const tiles = [
      'accessibility-severity',
      'fcp-counter',
      'broken-links',
      'seo-score',
      'cwv-pass-rate',
      'client-errors',
      'security-findings',
      'visual-regression'
    ];
    for (const tile of tiles) expect(file).toContain(`data-tile=\"${tile}\"`);
  });
});
