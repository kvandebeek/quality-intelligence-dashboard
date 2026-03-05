import { describe, expect, it } from 'vitest';
import { normalizeSelector, normalizeUxIssueTargets } from '../src/collectors/uxSuiteCollector.js';

describe('uxSuiteCollector target normalization', () => {
  it('normalizes selector spacing', () => {
    expect(normalizeSelector('  div   >  .cta,span  + a  ')).toBe('div > .cta, span + a');
  });

  it('dedupes and stable sorts string/object targets', () => {
    const normalized = normalizeUxIssueTargets([
      ' button.primary ',
      { selector: 'div  > a' },
      { selector: 'button.primary' },
      'a.link',
      '  a.link '
    ]);

    expect(normalized).toEqual([
      'a.link',
      'button.primary',
      { selector: 'div > a' }
    ]);
  });
});
