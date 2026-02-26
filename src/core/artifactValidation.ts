import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { ensureDir } from '../utils/file.js';
import { artifactMetaSchema, type ArtifactMeta } from '../models/platform.js';

const wrapped = <T extends z.ZodTypeAny>(payload: T) => z.object({ meta: artifactMetaSchema, payload });

export const artifactSchemas = {
  performance: wrapped(z.object({ url: z.string().url(), navigation: z.record(z.string(), z.number()), paint: z.record(z.string(), z.number().nullable()), resourceSummary: z.object({ count: z.number(), transferSize: z.number(), encodedBodySize: z.number(), decodedBodySize: z.number() }) })),
  accessibility: wrapped(z.object({ url: z.string().url(), issues: z.array(z.object({ id: z.string(), impact: z.string(), description: z.string(), help: z.string(), nodes: z.number(), tags: z.array(z.string()), recommendation: z.string() })), counters: z.record(z.string(), z.number()) })),
  networkRequests: wrapped(z.array(z.object({ url: z.string(), method: z.string(), status: z.number(), resourceType: z.string(), transferSize: z.number(), durationMs: z.number(), fromCache: z.boolean() }))),
  networkRecommendations: wrapped(z.array(z.object({ id: z.string(), title: z.string(), description: z.string(), severity: z.string(), impactedCount: z.number() }))),
  coreWebVitals: wrapped(z.object({ lcp: z.number().nullable(), cls: z.number().nullable(), inp: z.number().nullable(), fcp: z.number().nullable() })),
  lighthouse: wrapped(z.object({ available: z.boolean(), categories: z.record(z.string(), z.number().nullable()), note: z.string().optional() })),
  throttled: wrapped(z.object({ available: z.boolean(), baselineLoadMs: z.number().nullable(), throttledLoadMs: z.number().nullable(), degradationFactor: z.number().nullable() })),
  security: wrapped(z.record(z.string(), z.union([z.boolean(), z.string(), z.null()]))),
  seo: wrapped(z.record(z.string(), z.union([z.boolean(), z.string(), z.number(), z.null()]))),
  visualRegression: wrapped(z.object({ baselineFound: z.boolean(), diffRatio: z.number().nullable(), passed: z.boolean() })),
  apiMonitoring: wrapped(z.object({ count: z.number(), errorRate: z.number(), p95Ms: z.number(), avgSize: z.number() })),
  brokenLinks: wrapped(z.object({ checked: z.number(), broken: z.number(), redirectChains: z.number(), loops: z.number(), details: z.array(z.object({ url: z.string(), status: z.number(), chainLength: z.number() })) })),
  thirdPartyRisk: wrapped(z.array(z.object({ domain: z.string(), requests: z.number(), transferSize: z.number(), avgDurationMs: z.number(), trackerHeuristic: z.boolean() }))),
  accessibilityBeyondAxe: wrapped(z.object({ keyboardReachable: z.boolean(), possibleFocusTrap: z.boolean(), contrastSimulationScore: z.number().nullable() })),
  stability: wrapped(z.object({ iterations: z.number(), loadEventSamples: z.array(z.number()), stdDevLoadMs: z.number(), coefficientOfVariation: z.number(), unstable: z.boolean() })),
  memory: wrapped(z.object({ samples: z.array(z.number()), growth: z.number().nullable() }))
};

export function writeValidatedArtifact<K extends keyof typeof artifactSchemas>(
  outputPath: string,
  schemaKey: K,
  meta: ArtifactMeta,
  payload: unknown
): void {
  const artifact = { meta, payload };
  artifactSchemas[schemaKey].parse(artifact);
  ensureDir(path.dirname(outputPath));
  fs.writeFileSync(outputPath, JSON.stringify(artifact, null, 2));
}
