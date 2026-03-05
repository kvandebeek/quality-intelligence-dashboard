import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveArtifactLocalPath } from '../src/dashboard/paths.js';

describe('resolveArtifactLocalPath', () => {
  it('decodes encoded separators in artifact keys', () => {
    const baseDir = path.join('C:', 'runs', 'artifacts');
    const resolved = resolveArtifactLocalPath(baseDir, 'a11y-beyond-axe%2Fcontrast-sample-1.png');
    expect(resolved).toBe(path.join(baseDir, 'a11y-beyond-axe', 'contrast-sample-1.png'));
    expect(resolved).not.toBe(path.join(baseDir, 'a11y-beyond-axe%2Fcontrast-sample-1.png'));
  });
});
