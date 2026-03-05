import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('domain overview UI smoke', () => {
  it('includes domain overview header/nav styling and updated overview tiles', () => {
    const file = fs.readFileSync(path.resolve('src/dashboard/app/app.js'), 'utf8');
    expect(file).toContain('Domain overview');
    expect(file).toContain("selectedView: 'domain-overview'");
    const tiles = [
      'accessibility-severity',
      'fcp-counter',
      'broken-links',
      'seo-score',
      'cwv-status-by-metric',
      'client-errors',
      'security-findings',
      'ux-summary'
    ];
    for (const tile of tiles) expect(file).toContain(`data-tile=\"${tile}\"`);
    expect(file).toContain('renderDomainHeader');
    expect(file).toContain('domain-overview-active');
    expect(file).toContain('No security findings');
    expect(file).toContain('Needs improvement');
    expect(file).toContain('renderIssueTargets');
    expect(file).toContain('Targets (');
    expect(file).toContain('+${remaining} more');
  });
});
