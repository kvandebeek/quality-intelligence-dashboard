import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { ZodError } from 'zod';
import { appConfigSchema, batchRunConfigSchema, type BatchRunConfigSchema } from './schema.js';
import type { AppConfig } from '../models/types.js';
import { buildBatchOutputDir, resolveBatchItemFolderName } from '../utils/artifactPaths.js';

dotenv.config();

export type LoadedRunPlan =
  | { kind: 'single'; config: AppConfig }
  | { kind: 'batch'; runs: BatchExpandedRun[] };

export interface BatchExpandedRun {
  index: number;
  total: number;
  name: string;
  startUrl: string;
  outputFolder: string;
  config: AppConfig;
}

/**
 * Converts unknown JSON data to an object-like record.
 *
 * Non-object values are normalized to an empty object so downstream parsing
 * paths can safely access optional fields.
 */
function toObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

/**
 * Applies environment-based Elasticsearch overrides on top of raw config data.
 */
function applyElasticEnv(raw: Record<string, unknown>): Record<string, unknown> {
  const elasticsearch = toObject(raw.elasticsearch);
  return {
    ...raw,
    elasticsearch: {
      ...elasticsearch,
      node: process.env.ELASTIC_NODE ?? elasticsearch.node,
      apiKey: process.env.ELASTIC_API_KEY ?? elasticsearch.apiKey,
      username: process.env.ELASTIC_USERNAME ?? elasticsearch.username,
      password: process.env.ELASTIC_PASSWORD ?? elasticsearch.password
    }
  };
}

/**
 * Parses and validates the final application configuration shape.
 */
function ensureAppConfig(raw: Record<string, unknown>): AppConfig {
  return appConfigSchema.parse(applyElasticEnv(raw));
}

/**
 * Produces a sanitized per-target output folder name for batch runs.
 */
export function createBatchOutputFolder(name: string, startUrl: string): string {
  return resolveBatchItemFolderName(name, startUrl);
}

function toIssueMessage(error: ZodError, entryIndex?: number): string {
  const scope = entryIndex === undefined ? 'config' : `batch[${entryIndex}]`;
  const detail = error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
  return `Invalid ${scope}: ${detail}`;
}

export function expandBatchRunConfig(raw: BatchRunConfigSchema): BatchExpandedRun[] {
  const defaultsRaw = toObject(raw.defaults);
  const baseConfig = ensureAppConfig({ ...defaultsRaw, startUrl: 'https://example.com' });

  return raw.batch.map((entry, index) => {
    const effectiveRaw: Record<string, unknown> = {
      ...baseConfig,
      name: entry.name,
      startUrl: entry.startUrl,
      crawl: entry.crawl,
      targets: []
    };

    try {
      const config = ensureAppConfig(effectiveRaw);
      const outputFolder = createBatchOutputFolder(entry.name, entry.startUrl);
      return {
        index: index + 1,
        total: raw.batch.length,
        name: entry.name,
        startUrl: entry.startUrl,
        outputFolder,
        config: {
          ...config,
          outputDir: buildBatchOutputDir(config.outputDir, entry.name, entry.startUrl)
        }
      };
    } catch (error) {
      if (error instanceof ZodError) {
        throw new Error(toIssueMessage(error, index));
      }
      throw error;
    }
  });
}

/**
 * Loads a config file and resolves it into either a single-run plan or an
 * expanded batch plan.
 */
export function loadRunPlan(configPath: string): LoadedRunPlan {
  const absolutePath = path.resolve(configPath);
  const fileContents = fs.readFileSync(absolutePath, 'utf-8');
  let raw: unknown;
  try {
    raw = JSON.parse(fileContents) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse config JSON at ${absolutePath}: ${message}`);
  }
  const asObject = toObject(raw);

  if (typeof asObject.startUrl === 'string') {
    return { kind: 'single', config: ensureAppConfig(asObject) };
  }

  if (Array.isArray(asObject.batch)) {
    try {
      const batchConfig = batchRunConfigSchema.parse(asObject);
      return { kind: 'batch', runs: expandBatchRunConfig(batchConfig) };
    } catch (error) {
      if (error instanceof ZodError) {
        throw new Error(toIssueMessage(error));
      }
      throw error;
    }
  }

  throw new Error('Invalid config shape. Expected a single-run config with startUrl or a batch config with batch[].');
}

/**
 * Loads and validates a single-run config file.
 */
export function loadConfig(configPath: string): AppConfig {
  const plan = loadRunPlan(configPath);
  if (plan.kind !== 'single') {
    throw new Error('Expected single-run config but received batch config.');
  }
  return plan.config;
}
