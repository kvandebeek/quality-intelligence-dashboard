import { describe, expect, it } from 'vitest';
import { SECTION_FILES } from '../src/dashboard/data.js';
import { SECTION_DEFINITIONS, SECTION_GROUPS } from '../src/dashboard/sectionCatalog.js';

describe('section catalog', () => {
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
