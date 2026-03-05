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


export type TargetSummary = z.infer<typeof targetSummarySchema>;
export type PerformanceReport = z.infer<typeof performanceSchema>;
export type AccessibilityReport = z.infer<typeof accessibilitySchema>;
export type AccessibilityIssue = z.infer<typeof accessibilityIssueSchema>;
