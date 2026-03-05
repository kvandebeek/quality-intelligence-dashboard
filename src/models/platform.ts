import { z } from 'zod';

export const TOOL_VERSION = '2.0.0';
export const SCHEMA_VERSION = '1.0.0';

export const artifactMetaSchema = z.object({
  runId: z.string().min(1),
  url: z.string().url(),
  urlSlug: z.string().min(1),
  timestamp: z.string().min(1),
  toolVersion: z.string().min(1),
  schemaVersion: z.string().min(1)
});

export type ArtifactMeta = z.infer<typeof artifactMetaSchema>;

export interface UnifiedUrlModel {
  meta: ArtifactMeta;
  performance: Record<string, number>;
  accessibility: { counters: Record<string, number>; issues: Array<{ id: string; impact: string; recommendation: string; nodes: number; tags: string[] }> };
  coreWebVitals: { lcp: number | null; cls: number | null; inp: number | null; fcp: number | null };
  throttled: { available: boolean; degradationFactor: number | null };
  security: Record<string, boolean | string | null>;
  seoScore: { overallScore: number };
  visualRegression: { baselineFound: boolean; diffRatio: number | null; passed: boolean };
  brokenLinks: {
    summary: { checked: number; broken: number; redirectChains: number; loops: number };
    items?: Array<{
      url: string;
      statusCode: number | null;
      chainLength: number;
      isBroken: boolean;
      isRedirectChain: boolean;
      hasLoop: boolean;
  brokenLinks: { checked: number; broken: number; redirectChains: number; loops: number; details?: Array<{ sourcePageUrl: string; brokenUrl: string; status: number; chainLength: number }> };
  brokenLinks: {
    checked: number;
    broken: number;
    redirectChains: number;
    loops: number;
    items?: Array<{
      brokenUrl: string;
      sourcePageUrl: string;
      linkText: string;
      statusCode: number | null;
      failureReason: '4xx' | '5xx' | 'timeout' | 'dns' | 'invalid_url' | 'request_failed' | 'blocked_by_cors';
    }>;
  };
  thirdPartyRisk: Array<{ domain: string; requests: number; transferSize: number; avgDurationMs: number; trackerHeuristic: boolean }>;
  accessibilityBeyondAxe: { keyboardReachable: boolean; possibleFocusTrap: boolean; possibleFocusTrapDetails?: { candidates: Array<Record<string, unknown>> }; contrastSimulationScore: number | null; contrastSimulationScoreReason?: string | null; contrastSimulationResult?: { status: 'ok' | 'not_available'; score: number | null; reasonCode?: 'missing_screenshots' | 'screenshot_capture_failed' | 'page_not_loaded' | 'no_text_nodes_detected' | 'insufficient_color_pairs' | 'algorithm_error' | 'timeout'; reasonMessage?: string; evidence: Record<string, unknown>; samples?: Array<Record<string, unknown>>; screenshotRefs?: string[] }; contrastSimulationDetails?: { method: Record<string, unknown>; findings: Array<Record<string, unknown>> } };
  stability: { iterations: number; stdDevLoadMs: number; coefficientOfVariation: number; unstable: boolean };
  memory: { samples: number[]; growth: number | null };
  derived: {
    performanceCompositeScore: number;
    accessibilityWeightedScore: number;
    backendFrontendRatio: { backendPercent: number; frontendPercent: number };
    blockingTimeRatio: number;
  };
  enterpriseScore: Record<string, number>;
}

export interface RunIndex {
  runId: string;
  timestamp: string;
  toolVersion: string;
  schemaVersion: string;
  urls: UnifiedUrlModel[];
  summary: {
    totalUrls: number;
    generatedAt: string;
    rankings: {
      performance: Array<{ url: string; score: number }>;
      accessibility: Array<{ url: string; score: number }>;
    };
  };
}
