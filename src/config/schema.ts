import { z } from 'zod';

const crawlSchema = z.object({
  enabled: z.boolean().default(false),
  maxDepth: z.number().int().nonnegative().default(2),
  maxPages: z.number().int().positive().default(50),
  includeExternalDomains: z.boolean().default(false),
  allowedDomains: z.array(z.string().min(1)).default([])
});

export const appConfigSchema = z
  .object({
    browser: z.enum(['chromium', 'firefox', 'webkit']).default('chromium'),
    headless: z.boolean().default(true),
    environment: z.string().min(1).default('local'),
    iteration: z.number().int().positive().default(1),
    outputDir: z.string().min(1).default('artifacts'),
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
    elasticsearch: z
      .object({
        enabled: z.boolean().default(false),
        node: z.string().url().optional(),
        apiKey: z.string().optional(),
        username: z.string().optional(),
        password: z.string().optional(),
        indexPrefix: z.string().default('cx-assurance')
      })
      .default({ enabled: false })
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
