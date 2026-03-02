import { describe, expect, it } from 'vitest';
import { SECTION_FILES } from '../src/dashboard/data.js';
import { GLOSSARY_TERMS, SECTION_DEFINITIONS, SECTION_GROUPS } from '../src/dashboard/sectionCatalog.js';

describe('section catalog', () => {
  it('matches the expected top-level group and section navigation order', () => {
    const expected = [
      { label: 'Accessibility', sections: ['a11y-beyond-axe.json', 'accessibility.json'] },
      { label: 'Performance', sections: ['core-web-vitals.json', 'lighthouse-summary.json', 'memory-profile.json', 'performance.json', 'cross-browser-performance.json', 'throttled-run.json'] },
      { label: 'Network', sections: ['api-monitoring.json', 'network-recommendations.json', 'network-requests.json'] },
      { label: 'Quality & Reliability', sections: ['target-summary.json', 'broken-links.json', 'stability.json'] },
      { label: 'Security & Risk', sections: ['security-scan.json', 'third-party-risk.json'] },
      { label: 'SEO', sections: ['seo-checks.json', 'seo-score.json'] },
      { label: 'Visual', sections: ['visual-current.png', 'visual-regression.json'] },
      { label: 'UX', sections: ['ux-overview.json', 'ux-sanity.json', 'ux-layout-stability.json', 'ux-interaction.json', 'ux-click-friction.json', 'ux-keyboard.json', 'ux-overlays.json', 'ux-readability.json', 'ux-forms.json', 'ux-visual-regression.json'] },
      { label: 'Reliability & Client Health', sections: ['client-errors.json', 'ux-friction.json', 'memory-leaks.json'] },
      { label: 'Performance Efficiency', sections: ['cache-analysis.json'] },
      { label: 'Resilience', sections: ['third-party-resilience.json'] },
      { label: 'Governance, Privacy & Security', sections: ['privacy-audit.json', 'runtime-security.json', 'dependency-risk.json'] },
      { label: 'Regression Intelligence', sections: ['regression-summary.json'] }
    ];

    expect(SECTION_GROUPS.map((group) => ({ label: group.label, sections: group.sections }))).toEqual(expected);
  });

  it('covers every section exactly once through grouped navigation', () => {
    const grouped = SECTION_GROUPS.flatMap((group) => group.sections);
    expect(grouped).toHaveLength(SECTION_FILES.length);
    expect(new Set(grouped).size).toBe(SECTION_FILES.length);
    expect([...grouped].sort()).toEqual([...SECTION_FILES].sort());
  });

  it('contains complete explanation payload per section', () => {
    for (const section of SECTION_FILES) {
      const definition = SECTION_DEFINITIONS[section];
      expect(definition).toBeDefined();
      expect(definition.info.whatItIs.length).toBeGreaterThan(10);
      expect(definition.info.whyItMatters.length).toBeGreaterThan(10);
      expect(definition.info.howToRead.length).toBeGreaterThanOrEqual(3);
      for (const keyTerm of definition.info.keyTerms) {
        expect(GLOSSARY_TERMS[keyTerm]).toBeDefined();
      }
    }
  });

  it('includes required key terms in sections that expose the corresponding cards', () => {
    expect(SECTION_DEFINITIONS['core-web-vitals.json'].info.keyTerms).toEqual(['lcp', 'cls', 'inp', 'fcp', 'readiness']);
    expect(SECTION_DEFINITIONS['performance.json'].info.keyTerms).toEqual(['dns', 'tcp', 'ttfb', 'dcl', 'load', 'fp', 'fcp']);
    expect(SECTION_DEFINITIONS['a11y-beyond-axe.json'].info.keyTerms).toEqual(['keyboardReachable', 'possibleFocusTrap', 'contrastSimulationScore']);
    expect(SECTION_DEFINITIONS['visual-regression.json'].info.keyTerms).toEqual(['baselineFound', 'diffRatio', 'passed']);
  });
});
