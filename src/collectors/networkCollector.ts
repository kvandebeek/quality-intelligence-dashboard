import fs from 'node:fs';
import type { NetworkRecommendation, NetworkRequestRecord } from '../models/types.js';

interface HarEntry {
  request: { method: string; url: string };
  response: { status: number; content?: { mimeType?: string; size?: number }; _transferSize?: number };
  time: number;
  cache?: Record<string, unknown>;
}

export function parseHar(harPath: string): NetworkRequestRecord[] {
  const raw = JSON.parse(fs.readFileSync(harPath, 'utf-8')) as { log: { entries: HarEntry[] } };
  return raw.log.entries.map((entry) => ({
    url: entry.request.url,
    method: entry.request.method,
    status: entry.response.status,
    resourceType: entry.response.content?.mimeType ?? 'unknown',
    transferSize: entry.response._transferSize ?? entry.response.content?.size ?? 0,
    durationMs: entry.time,
    fromCache: Boolean(entry.cache && Object.keys(entry.cache).length > 0)
  }));
}

export function recommendNetworkOptimizations(records: NetworkRequestRecord[]): NetworkRecommendation[] {
  const largeResources = records.filter((r) => r.transferSize > 300_000);
  const slowResources = records.filter((r) => r.durationMs > 1000);
  const noCompressionCandidates = records.filter((r) => r.resourceType.includes('javascript') && r.transferSize > 100_000);
  const recommendations: NetworkRecommendation[] = [];

  if (largeResources.length > 0) {
    recommendations.push({
      id: 'net-large-assets',
      title: 'Reduce large assets',
      description: 'Large resources detected; consider compression, code-splitting, and lazy loading.',
      severity: 'high',
      impactedCount: largeResources.length
    });
  }

  if (slowResources.length > 0) {
    recommendations.push({
      id: 'net-slow-requests',
      title: 'Address slow requests',
      description: 'Requests exceeding 1s were found; evaluate backend latency and caching strategy.',
      severity: 'medium',
      impactedCount: slowResources.length
    });
  }

  if (noCompressionCandidates.length > 0) {
    recommendations.push({
      id: 'net-js-compression',
      title: 'Improve JS delivery efficiency',
      description: 'Large JavaScript payloads detected; ensure Brotli/Gzip and minification are enabled.',
      severity: 'low',
      impactedCount: noCompressionCandidates.length
    });
  }

  return recommendations;
}
