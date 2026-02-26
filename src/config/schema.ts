import { z } from 'zod';

export const appConfigSchema = z.object({
  browser: z.enum(['chromium', 'firefox', 'webkit']).default('chromium'),
  headless: z.boolean().default(true),
  environment: z.string().min(1).default('local'),
  iteration: z.number().int().positive().default(1),
  outputDir: z.string().min(1).default('artifacts'),
  targets: z.array(z.object({
    name: z.string().min(1),
    url: z.string().url(),
    waitForSelector: z.string().optional()
  })).min(1),
  elasticsearch: z.object({
    enabled: z.boolean().default(false),
    node: z.string().url().optional(),
    apiKey: z.string().optional(),
    username: z.string().optional(),
    password: z.string().optional(),
    indexPrefix: z.string().default('cx-assurance')
  }).default({ enabled: false })
});

export type AppConfigSchema = z.infer<typeof appConfigSchema>;
