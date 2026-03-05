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
  it('accepts seo-score payloads with structured subscore checks', () => {
    const output = path.join(os.tmpdir(), `seo-score-${Date.now()}.json`);

    expect(() => writeValidatedArtifact(output, 'seoScore', meta, {
      version: 'seo-score-v1',
      url: 'https://example.com/',
      generatedAt: '2026-01-01T00:00:00.000Z',
      overallScore: 88.5,
      weights: { indexability: 0.35, onPage: 0.3, content: 0.2, performanceProxy: 0.15 },
      subscores: {
        indexability: { score: 92, measuredWeight: 1, checks: [{ id: 'robots.txt', status: 'pass' }] },
        onPage: { score: 90, measuredWeight: 1, checks: [] },
        content: { score: 85, measuredWeight: 1, checks: [] },
        performanceProxy: { score: 80, measuredWeight: 1, checks: [] }
      },
      checks: [{ id: 'robots.txt', status: 'pass' }]
    })).not.toThrow();

    const written = JSON.parse(fs.readFileSync(output, 'utf8')) as { payload: { subscores: { indexability: { score: number } } } };
    expect(written.payload.subscores.indexability.score).toBe(92);

    fs.rmSync(output, { force: true });
  });

  it('accepts broken-links payloads with structured summary and nullable statusCode items', () => {
    const output = path.join(os.tmpdir(), `broken-links-${Date.now()}.json`);

    expect(() => writeValidatedArtifact(output, 'brokenLinks', meta, {
      summary: { checked: 2, broken: 1, redirectChains: 0, loops: 0 },
      items: [
        { url: 'https://example.com/a', statusCode: 200, chainLength: 1, isBroken: false, isRedirectChain: false, hasLoop: false },
        { url: 'https://example.com/missing', statusCode: null, chainLength: 1, isBroken: true, isRedirectChain: false, hasLoop: false }
      ]
    })).not.toThrow();

    const written = JSON.parse(fs.readFileSync(output, 'utf8')) as { payload: { items: Array<{ statusCode: number | null }> } };
    expect(written.payload.items[1]?.statusCode).toBeNull();

    fs.rmSync(output, { force: true });
  });
});
