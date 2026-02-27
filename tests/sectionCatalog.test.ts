import { describe, expect, it } from 'vitest';
import { SECTION_FILES } from '../src/dashboard/data.js';
import { SECTION_DEFINITIONS, SECTION_GROUPS } from '../src/dashboard/sectionCatalog.js';

describe('section catalog', () => {
  it('matches the expected top-level group and sub-group navigation order', () => {
    const expected = [
      { label: 'Quality & Reliability', sections: ['target-summary.json', 'broken-links.json', 'stability.json'] },
      { label: 'Accessibility', sections: ['a11y-beyond-axe.json', 'accessibility.json'] },
      { label: 'Performance', sections: ['core-web-vitals.json', 'lighthouse-summary.json', 'memory-profile.json', 'performance.json', 'throttled-run.json'] },
      { label: 'Network', sections: ['api-monitoring.json', 'network-recommendations.json', 'network-requests.json'] },
      { label: 'Security & Risk', sections: ['security-scan.json', 'third-party-risk.json'] },
      { label: 'SEO', sections: ['seo-checks.json'] },
      { label: 'Visual', sections: ['visual-current.png', 'visual-regression.json'] }
    ];

    expect(SECTION_GROUPS.map((group) => ({ label: group.label, sections: group.sections }))).toEqual(expected);
  });

  it('covers every section exactly once through grouped navigation', () => {
    const grouped = SECTION_GROUPS.flatMap((group) => group.sections);
    expect(grouped).toHaveLength(SECTION_FILES.length);
    expect(new Set(grouped).size).toBe(SECTION_FILES.length);
    expect([...grouped].sort()).toEqual([...SECTION_FILES].sort());
  });

  it('contains complete info payload per section', () => {
    for (const section of SECTION_FILES) {
      const definition = SECTION_DEFINITIONS[section];
      expect(definition).toBeDefined();
      expect(definition.info.whatItIs.length).toBeGreaterThan(10);
      expect(definition.info.whyItMatters.length).toBeGreaterThan(10);
      expect(definition.info.howToRead.length).toBeGreaterThanOrEqual(2);
    }
  });
});
