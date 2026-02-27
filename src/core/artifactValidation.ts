import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { ensureDir } from '../utils/file.js';
import { artifactMetaSchema, type ArtifactMeta } from '../models/platform.js';

const wrapped = <T extends z.ZodTypeAny>(payload: T) => z.object({ meta: artifactMetaSchema, payload });

const lighthousePayloadSchema = z.preprocess((value) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
  const payload = value as Record<string, unknown>;
  if (payload.categories && typeof payload.categories === 'object' && payload.categories !== null) return value;

  const legacyCategories = {
    performance: payload.performance,
    accessibility: payload.accessibility,
    bestPractices: payload.bestPractices,
    seo: payload.seo
  };
  const hasLegacyCategory = Object.values(legacyCategories).some((metric) => metric !== undefined);
  if (!hasLegacyCategory) return value;

  return {
    available: payload.available,
    categories: legacyCategories,
    note: payload.note
  };
}, z.object({ available: z.boolean(), categories: z.record(z.string(), z.number().nullable()), note: z.string().optional() }));

export const artifactSchemas = {
  performance: wrapped(z.object({ url: z.string().url(), navigation: z.record(z.string(), z.number()), paint: z.record(z.string(), z.number().nullable()), resourceSummary: z.object({ count: z.number(), transferSize: z.number(), encodedBodySize: z.number(), decodedBodySize: z.number() }) })),
  accessibility: wrapped(z.object({ url: z.string().url(), issues: z.array(z.object({ id: z.string(), impact: z.string(), description: z.string(), help: z.string(), nodes: z.number(), tags: z.array(z.string()), recommendation: z.string() })), counters: z.record(z.string(), z.number()) })),
  networkRequests: wrapped(z.array(z.object({ url: z.string(), method: z.string(), status: z.number(), resourceType: z.string(), transferSize: z.number(), durationMs: z.number(), fromCache: z.boolean() }))),
  networkRecommendations: wrapped(z.array(z.object({ id: z.string(), title: z.string(), description: z.string(), severity: z.string(), impactedCount: z.number() }))),
  coreWebVitals: wrapped(z.object({ lcp: z.number().nullable(), cls: z.number().nullable(), inp: z.number().nullable(), fcp: z.number().nullable() })),
  lighthouse: wrapped(lighthousePayloadSchema),
  throttled: wrapped(z.object({ available: z.boolean(), baselineLoadMs: z.number().nullable(), throttledLoadMs: z.number().nullable(), degradationFactor: z.number().nullable() })),
  security: wrapped(z.record(z.string(), z.union([z.boolean(), z.string(), z.null()]))),
  seo: wrapped(z.record(z.string(), z.union([z.boolean(), z.string(), z.number(), z.null()]))),
  visualRegression: wrapped(z.object({ baselineFound: z.boolean(), diffRatio: z.number().nullable(), passed: z.boolean() })),
  apiMonitoring: wrapped(z.object({ count: z.number(), errorRate: z.number(), p95Ms: z.number(), avgSize: z.number() })),
  brokenLinks: wrapped(z.object({ checked: z.number(), broken: z.number(), redirectChains: z.number(), loops: z.number(), details: z.array(z.object({ url: z.string(), status: z.number(), chainLength: z.number() })) })),
  thirdPartyRisk: wrapped(z.array(z.object({ domain: z.string(), requests: z.number(), transferSize: z.number(), avgDurationMs: z.number(), trackerHeuristic: z.boolean() }))),
  accessibilityBeyondAxe: wrapped(z.object({ keyboardReachable: z.boolean(), possibleFocusTrap: z.boolean(), contrastSimulationScore: z.number().nullable(), contrastSimulationScoreReason: z.string().nullable().optional() })),
  stability: wrapped(z.object({ iterations: z.number(), loadEventSamples: z.array(z.number()), stdDevLoadMs: z.number(), coefficientOfVariation: z.number(), unstable: z.boolean() })),
  memory: wrapped(z.object({ samples: z.array(z.number()), growth: z.number().nullable() })),

  clientErrors: wrapped(z.object({ totalErrors: z.number(), severityScore: z.number(), uncaughtExceptions: z.number(), unhandledRejections: z.number(), consoleErrors: z.number(), consoleWarnings: z.number(), failedRequests: z.array(z.object({ url: z.string(), type: z.string(), reason: z.string() })), topErrors: z.array(z.object({ message: z.string(), count: z.number(), example: z.string().optional() })) })),
  uxFriction: wrapped(z.object({ rageClicks: z.number(), deadClicks: z.number(), longTasks: z.number(), layoutShifts: z.number(), topSelectors: z.array(z.object({ selector: z.string(), count: z.number() })), uxScore: z.number() })),
  memoryLeaks: wrapped(z.object({ available: z.boolean(), mode: z.enum(['cdp', 'performance.memory', 'not_supported']), initialHeapMB: z.number().nullable(), finalHeapMB: z.number().nullable(), growthMB: z.number().nullable(), leakRisk: z.enum(['low', 'medium', 'high', 'unknown']), evidence: z.array(z.string()) })),
  cacheAnalysis: wrapped(z.object({ cold: z.object({ ttfbMs: z.number().nullable(), fcpMs: z.number().nullable(), lcpMs: z.number().nullable() }), warm: z.object({ ttfbMs: z.number().nullable(), fcpMs: z.number().nullable(), lcpMs: z.number().nullable() }), improvementPercent: z.number(), cacheScore: z.number(), poorlyCachedAssets: z.array(z.object({ url: z.string(), cacheControl: z.string(), expires: z.string(), etag: z.string(), lastModified: z.string() })) })),
  thirdPartyResilience: wrapped(z.object({ blockedDomains: z.array(z.string()), functionalBreakage: z.boolean(), layoutImpact: z.enum(['none', 'low', 'moderate', 'high']), resilienceScore: z.number() })),
  privacyAudit: wrapped(z.object({ consentBannerDetected: z.boolean(), cookiesBeforeConsent: z.array(z.object({ name: z.string(), value: z.string() })), insecureCookies: z.array(z.object({ name: z.string(), issue: z.string() })), thirdPartyTrackers: z.array(z.string()), gdprRisk: z.enum(['low', 'medium', 'high']) })),
  runtimeSecurity: wrapped(z.object({ missingHeaders: z.array(z.string()), cspStrength: z.enum(['none', 'weak', 'ok', 'strong']), mixedContent: z.array(z.string()), inlineScripts: z.number(), evalSignals: z.number(), securityScore: z.number() })),
  dependencyRisk: wrapped(z.object({ domainInventory: z.array(z.object({ domain: z.string(), category: z.string(), scripts: z.number(), iframes: z.number(), images: z.number(), fonts: z.number() })), dependencyRiskScore: z.number(), topRiskyDependencies: z.array(z.object({ domain: z.string(), category: z.string(), score: z.number() })) }))

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
