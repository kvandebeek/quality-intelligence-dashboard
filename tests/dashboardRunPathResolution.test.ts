import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveRunPath } from '../src/dashboard/data.js';

describe('resolveRunPath', () => {
  it('uses current working directory when run path is not provided', () => {
    expect(resolveRunPath({})).toBe(process.cwd());
  });

  it('prefers explicit run path values', () => {
    expect(resolveRunPath({ cliRunPath: 'tests/fixtures/dashboard-run' })).toBe(path.resolve('tests/fixtures/dashboard-run'));
    expect(resolveRunPath({ envRunPath: 'tests/fixtures/dashboard-run' })).toBe(path.resolve('tests/fixtures/dashboard-run'));
  });
});
