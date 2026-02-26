import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { appConfigSchema } from './schema.js';
import type { AppConfig } from '../models/types.js';

dotenv.config();

export function loadConfig(configPath: string): AppConfig {
  const absolutePath = path.resolve(configPath);
  const raw = JSON.parse(fs.readFileSync(absolutePath, 'utf-8')) as Record<string, unknown>;

  const merged = {
    ...raw,
    elasticsearch: {
      ...(raw.elasticsearch as Record<string, unknown> | undefined),
      node: process.env.ELASTIC_NODE ?? (raw.elasticsearch as { node?: string } | undefined)?.node,
      apiKey: process.env.ELASTIC_API_KEY ?? (raw.elasticsearch as { apiKey?: string } | undefined)?.apiKey,
      username: process.env.ELASTIC_USERNAME ?? (raw.elasticsearch as { username?: string } | undefined)?.username,
      password: process.env.ELASTIC_PASSWORD ?? (raw.elasticsearch as { password?: string } | undefined)?.password
    }
  };

  const parsed = appConfigSchema.parse(merged);
  return parsed;
}
