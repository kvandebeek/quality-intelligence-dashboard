import { z } from 'zod';

export const targetSummarySchema = z.object({
  target: z.object({
    name: z.string(),
    url: z.string().url(),
    waitForSelector: z.string().optional()
  }),
  performance: z.object({
    url: z.string().url(),
    navigation: z.record(z.string(), z.number()),
    paint: z.record(z.string(), z.number().nullable()),
    resourceSummary: z.object({
      count: z.number().nonnegative(),
      transferSize: z.number().nonnegative(),
      encodedBodySize: z.number().nonnegative(),
      decodedBodySize: z.number().nonnegative()
    })
  }),
  network: z.object({
    harPath: z.string(),
    requests: z.array(z.unknown()),
    recommendations: z.array(z.unknown())
  }),
  accessibility: z.object({
    url: z.string().url(),
    issues: z.array(z.unknown()),
    counters: z.record(z.string(), z.number().nonnegative())
  })
});

export const performanceSchema = z.object({
  url: z.string().url(),
  navigation: z.record(z.string(), z.number()),
  paint: z.record(z.string(), z.number().nullable()),
  resourceSummary: z.object({
    count: z.number().nonnegative(),
    transferSize: z.number().nonnegative(),
    encodedBodySize: z.number().nonnegative(),
    decodedBodySize: z.number().nonnegative()
  })
});

export const accessibilityIssueSchema = z.object({
  id: z.string(),
  impact: z.string(),
  description: z.string(),
  help: z.string(),
  nodes: z.number().nonnegative(),
  tags: z.array(z.string()),
  recommendation: z.string()
});

export const accessibilitySchema = z.object({
  url: z.string().url(),
  issues: z.array(accessibilityIssueSchema),
  counters: z.record(z.string(), z.number().nonnegative())
});

export const networkRequestSchema = z.object({
  url: z.string(),
  method: z.string(),
  status: z.number().int(),
  resourceType: z.string(),
  transferSize: z.number(),
  durationMs: z.number(),
  fromCache: z.boolean()
});

export const networkRequestsSchema = z.array(networkRequestSchema);

export const networkRecommendationSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  severity: z.string(),
  impactedCount: z.number().int().nonnegative()
});

export const networkRecommendationsSchema = z.array(networkRecommendationSchema);

export type TargetSummary = z.infer<typeof targetSummarySchema>;
export type PerformanceReport = z.infer<typeof performanceSchema>;
export type AccessibilityReport = z.infer<typeof accessibilitySchema>;
export type AccessibilityIssue = z.infer<typeof accessibilityIssueSchema>;
export type NetworkRequest = z.infer<typeof networkRequestSchema>;
export type NetworkRecommendation = z.infer<typeof networkRecommendationSchema>;
