import { z } from 'zod';

const crawlSchema = z.object({
  enabled: z.boolean().default(false),
  maxDepth: z.number().int().nonnegative().default(2),
  maxPages: z.number().int().positive().default(50),
  includeExternalDomains: z.boolean().default(false),
  allowedDomains: z.array(z.string().min(1)).default([])
});

const consentSchema = z.object({
  enabled: z.boolean().default(true),
  timeoutMs: z.number().int().positive().default(1500)
});

const assuranceModulesSchema = z.object({
  enabled: z.object({
    clientErrors: z.boolean().default(true),
    uxFriction: z.boolean().default(true),
    memoryLeaks: z.boolean().default(true),
    cacheAnalysis: z.boolean().default(true),
    thirdPartyResilience: z.boolean().default(true),
    privacyAudit: z.boolean().default(true),
    runtimeSecurity: z.boolean().default(true),
    dependencyRisk: z.boolean().default(true),
    regressionDelta: z.boolean().default(true)
  }).default({}),
  clientErrors: z.object({
    topErrorsLimit: z.number().int().positive().default(10),
    ignoreMessages: z.array(z.string()).default([])
  }).default({}),
  ux: z.object({
    rageClickWindowMs: z.number().int().positive().default(1200),
    rageClickThreshold: z.number().int().min(2).default(3),
    deadClickWindowMs: z.number().int().positive().default(700)
  }).default({}),
  memory: z.object({
    interactionLoops: z.number().int().positive().default(5),
    growthThresholdMB: z.number().positive().default(8)
  }).default({}),
  cache: z.object({
    minStaticTtlSeconds: z.number().int().nonnegative().default(3600)
  }).default({}),
  thirdPartyResilience: z.object({
    mode: z.enum(['trackers-only', 'all-third-party']).default('trackers-only'),
    defaultBlocklist: z.array(z.string()).default(['google-analytics.com', 'googletagmanager.com', 'doubleclick.net'])
  }).default({}),
  privacy: z.object({
    consentSelectors: z.array(z.string()).default(['[id*="consent"]', '[class*="cookie"]', '[aria-label*="consent"]']),
    mode: z.enum(['pre-consent', 'post-consent']).default('pre-consent'),
    trackerDomains: z.array(z.string()).default(['google-analytics.com', 'googletagmanager.com', 'doubleclick.net', 'facebook.net'])
  }).default({}),
  dependencyRisk: z.object({
    categoryRules: z.record(z.string(), z.string()).default({
      'google-analytics': 'analytics',
      'googletagmanager': 'analytics',
      'doubleclick': 'ads',
      'cdn': 'cdn',
      'stripe': 'payment',
      'intercom': 'chat'
    })
  }).default({}),
  regression: z.object({
    elevatedThreshold: z.number().int().min(1).default(35),
    watchThreshold: z.number().int().min(1).default(15)
  }).default({})
}).default({});

export const appConfigSchema = z
  .object({
    browser: z.enum(['chromium', 'firefox', 'webkit']).default('chromium'),
    headless: z.boolean().default(true),
    environment: z.string().min(1).default('local'),
    iteration: z.number().int().positive().default(1),
    outputDir: z.string().min(1).default('artifacts'),
    name: z.string().min(1).optional(),
    startUrl: z.string().url(),
    targets: z
      .array(
        z.object({
          name: z.string().min(1),
          url: z.string().url(),
          waitForSelector: z.string().optional()
        })
      )
      .default([]),
    crawl: crawlSchema.default({
      enabled: false,
      maxDepth: 2,
      maxPages: 50,
      includeExternalDomains: false,
      allowedDomains: []
    }),
    consent: consentSchema.default({
      enabled: true,
      timeoutMs: 1500
    }),
    elasticsearch: z
      .object({
        enabled: z.boolean().default(false),
        node: z.string().url().optional(),
        apiKey: z.string().optional(),
        username: z.string().optional(),
        password: z.string().optional(),
        indexPrefix: z.string().default('quality-signal')
      })
      .default({ enabled: false }),
    assuranceModules: assuranceModulesSchema
  })
  .superRefine((value, ctx) => {
    if (value.crawl.enabled && value.crawl.allowedDomains.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'crawl.allowedDomains must include at least one domain when crawl is enabled.',
        path: ['crawl', 'allowedDomains']
      });
    }
  });

export type AppConfigSchema = z.infer<typeof appConfigSchema>;
