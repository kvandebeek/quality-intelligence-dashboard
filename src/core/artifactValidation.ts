import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { ensureDir } from '../utils/file.js';
import { artifactMetaSchema, type ArtifactMeta } from '../models/platform.js';

const wrapped = <T extends z.ZodTypeAny>(payload: T) => z.object({ meta: artifactMetaSchema, payload });

export const artifactSchemas = {
  performance: wrapped(z.object({ url: z.string().url(), navigation: z.record(z.string(), z.number()), paint: z.record(z.string(), z.number().nullable()), resourceSummary: z.object({ count: z.number(), transferSize: z.number(), encodedBodySize: z.number(), decodedBodySize: z.number() }) })),
  accessibility: wrapped(z.object({ url: z.string().url(), issues: z.array(z.object({ id: z.string(), impact: z.string(), description: z.string(), help: z.string(), nodes: z.number(), tags: z.array(z.string()), recommendation: z.string() })), counters: z.record(z.string(), z.number()) })),
  coreWebVitals: wrapped(z.object({ lcp: z.number().nullable(), cls: z.number().nullable(), inp: z.number().nullable(), fcp: z.number().nullable() })),
  throttled: wrapped(z.object({ available: z.boolean(), baselineLoadMs: z.number().nullable(), throttledLoadMs: z.number().nullable(), degradationFactor: z.number().nullable() })),
  security: wrapped(z.record(z.string(), z.union([z.boolean(), z.string(), z.null()]))),
  seoScore: wrapped(z.object({
    version: z.literal('seo-score-v1'),
    url: z.string().url(),
    generatedAt: z.string(),
    overallScore: z.number(),
    weights: z.object({ indexability: z.number(), onPage: z.number(), content: z.number(), performanceProxy: z.number() }),
    subscores: z.object({
      indexability: z.object({ score: z.number(), measuredWeight: z.number(), checks: z.array(z.record(z.string(), z.unknown())) }),
      onPage: z.object({ score: z.number(), measuredWeight: z.number(), checks: z.array(z.record(z.string(), z.unknown())) }),
      content: z.object({ score: z.number(), measuredWeight: z.number(), checks: z.array(z.record(z.string(), z.unknown())) }),
      performanceProxy: z.object({ score: z.number(), measuredWeight: z.number(), checks: z.array(z.record(z.string(), z.unknown())) })
    }),
    checks: z.array(z.record(z.string(), z.unknown()))
  })),
  visualRegression: wrapped(z.object({ baselineFound: z.boolean(), diffRatio: z.number().nullable(), passed: z.boolean() })),
  brokenLinks: wrapped(z.object({ checked: z.number(), broken: z.number(), redirectChains: z.number(), loops: z.number(), details: z.array(z.object({ url: z.string(), status: z.number(), chainLength: z.number() })) })),
  thirdPartyRisk: wrapped(z.array(z.object({ domain: z.string(), requests: z.number(), transferSize: z.number(), avgDurationMs: z.number(), trackerHeuristic: z.boolean() }))),
  accessibilityBeyondAxe: wrapped(z.object({ keyboardReachable: z.boolean(), possibleFocusTrap: z.boolean(), contrastSimulationScore: z.number().nullable(), contrastSimulationScoreReason: z.string().nullable().optional() })),
  stability: wrapped(z.object({ iterations: z.number(), loadEventSamples: z.array(z.number()), stdDevLoadMs: z.number(), coefficientOfVariation: z.number(), unstable: z.boolean() })),
  memory: wrapped(z.object({ samples: z.array(z.number()), growth: z.number().nullable() })),
  crossBrowserPerformance: wrapped(z.object({
    category: z.literal('performance'),
    crossBrowserPerformance: z.object({
      status: z.enum(['tested', 'untested']),
      reason: z.enum(['disabled', 'missing_config', 'invalid_config', 'skipped_headless', 'no_browsers_configured']).nullable(),
      config: z.object({
        enabled: z.boolean(),
        browsers: z.array(z.enum(['chromium', 'firefox', 'webkit'])),
        runs: z.number().int().positive()
      }),
      results: z.array(z.object({
        browser: z.enum(['chromium', 'firefox', 'webkit']),
        avgLoadMs: z.number(),
        minLoadMs: z.number(),
        maxLoadMs: z.number(),
        samples: z.number().int().positive()
      }))
    })
  })),

  clientErrors: wrapped(z.object({ totalErrors: z.number(), severityScore: z.number(), uncaughtExceptions: z.number(), unhandledRejections: z.number(), consoleErrors: z.number(), consoleWarnings: z.number(), failedRequests: z.array(z.object({ url: z.string(), type: z.string(), reason: z.string() })), topErrors: z.array(z.object({ message: z.string(), count: z.number(), example: z.string().optional() })) })),
  memoryLeaks: wrapped(z.object({ available: z.boolean(), mode: z.enum(['cdp', 'performance.memory', 'not_supported']), initialHeapMB: z.number().nullable(), finalHeapMB: z.number().nullable(), growthMB: z.number().nullable(), leakRisk: z.enum(['low', 'medium', 'high', 'unknown']), evidence: z.array(z.string()) })),
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
