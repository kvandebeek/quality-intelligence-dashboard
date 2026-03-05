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



const brokenLinkScreenshotSchema = z.object({
  type: z.enum(['snippet', 'fullpage', 'none']),
  path: z.string().nullable(),
  thumbnailPath: z.string().nullable(),
  elementSelector: z.string().optional(),
  bbox: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).optional(),
  crop: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).optional(),
  error: z.string().optional()
});

export const brokenLinksItemSchema = z.union([
  z.object({
    url: z.string(),
    statusCode: z.number().nullable(),
    chainLength: z.number().nonnegative(),
    isBroken: z.boolean(),
    isRedirectChain: z.boolean(),
    hasLoop: z.boolean()
  }),
  z.object({
    brokenUrl: z.string(),
    sourcePageUrl: z.string(),
    linkText: z.string().optional(),
    selector: z.string().nullable().optional(),
    findingId: z.string().optional(),
    statusCode: z.number().nullable(),
    failureReason: z.string().optional(),
    screenshot: brokenLinkScreenshotSchema.optional()
  })
]);

export const brokenLinksSchema = z.object({
  summary: z.object({
    checked: z.number().nonnegative(),
    broken: z.number().nonnegative(),
    redirectChains: z.number().nonnegative(),
    loops: z.number().nonnegative()
  }),
  items: z.array(brokenLinksItemSchema).optional()
});

export type TargetSummary = z.infer<typeof targetSummarySchema>;
export type PerformanceReport = z.infer<typeof performanceSchema>;
export type AccessibilityReport = z.infer<typeof accessibilitySchema>;
export type AccessibilityIssue = z.infer<typeof accessibilityIssueSchema>;

export type BrokenLinksReport = z.infer<typeof brokenLinksSchema>;
export type BrokenLinksItem = z.infer<typeof brokenLinksItemSchema>;
