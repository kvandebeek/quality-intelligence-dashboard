import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeValidatedArtifact } from '../src/core/artifactValidation.js';
import type { ArtifactMeta } from '../src/models/platform.js';

const meta: ArtifactMeta = {
  runId: 'run-test',
  url: 'https://example.com/',
  urlSlug: 'example-com',
  timestamp: '2026-01-01T00:00:00.000Z',
  toolVersion: '2.0.0',
  schemaVersion: '1.0.0'
};

describe('artifact validation', () => {
  it('accepts nested objects in seo payload subscores', () => {
    const output = path.join(os.tmpdir(), `seo-checks-${Date.now()}.json`);

    expect(() => writeValidatedArtifact(output, 'seo', meta, {
      overallScore: 88.5,
      subscores: {
        indexability: {
          score: 92,
          checks: [{ id: 'robots.txt', status: 'pass' }]
        }
      },
      robotsTxtAllows: true
    })).not.toThrow();

    const written = JSON.parse(fs.readFileSync(output, 'utf8')) as { payload: { subscores: { indexability: { score: number } } } };
    expect(written.payload.subscores.indexability.score).toBe(92);

    fs.rmSync(output, { force: true });
  });
});
