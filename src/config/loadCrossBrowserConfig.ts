import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import {
  CROSS_BROWSER_DEFAULT_BROWSERS,
  CROSS_BROWSER_DEFAULT_RUNS,
  type BrowserName,
  type CrossBrowserConfig,
  type LoadedCrossBrowserConfig
} from '../models/types.js';

const CONFIG_RELATIVE_PATH = 'config/features.json';

const browserSchema = z.enum(['chromium', 'firefox', 'webkit']);

const crossBrowserConfigSchema = z.object({
  enabled: z.boolean(),
  browsers: z.array(browserSchema).optional(),
  runs: z.number().int().optional(),
  navigationTimeoutMs: z.number().int().positive().optional(),
  cooldownMs: z.number().int().min(0).optional(),
  skipIfHeadless: z.boolean().optional()
});

function clampRuns(runs: number | undefined): number {
  if (typeof runs !== 'number' || !Number.isFinite(runs)) return CROSS_BROWSER_DEFAULT_RUNS;
  if (runs < 1 || runs > 20) return CROSS_BROWSER_DEFAULT_RUNS;
  return runs;
}

function normalize(raw: z.infer<typeof crossBrowserConfigSchema>): CrossBrowserConfig {
  const browsers = (raw.browsers ?? [...CROSS_BROWSER_DEFAULT_BROWSERS]) as BrowserName[];
  return {
    enabled: raw.enabled,
    browsers,
    runs: clampRuns(raw.runs),
    navigationTimeoutMs: raw.navigationTimeoutMs,
    cooldownMs: raw.cooldownMs ?? 0,
    skipIfHeadless: raw.skipIfHeadless ?? false
  };
}

function disabledConfig(): CrossBrowserConfig {
  return {
    enabled: false,
    browsers: [...CROSS_BROWSER_DEFAULT_BROWSERS],
    runs: CROSS_BROWSER_DEFAULT_RUNS,
    cooldownMs: 0,
    skipIfHeadless: false
  };
}

export function loadCrossBrowserConfig(): LoadedCrossBrowserConfig {
  const configPath = path.resolve(CONFIG_RELATIVE_PATH);

  if (!fs.existsSync(configPath)) {
    return { source: 'missing', config: disabledConfig() };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as unknown;
    const validated = crossBrowserConfigSchema.parse(parsed);
    return { source: 'file', config: normalize(validated) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[cross-browser-performance] invalid config at config/features.json: ${message}\n`);
    return { source: 'invalid', config: disabledConfig() };
  }
}
