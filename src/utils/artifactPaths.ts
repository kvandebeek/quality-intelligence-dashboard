import fs from 'node:fs';
import path from 'node:path';

const INVALID_PATH_CHARS = /[<>:"/\\|?*\x00-\x1F]/g;

function collapseUnderscores(value: string): string {
  return value.replace(/_+/g, '_').replace(/^_+|_+$/g, '');
}

export function sanitizeBatchItemName(name: string): string {
  return collapseUnderscores(name.trim().replace(INVALID_PATH_CHARS, '_'));
}

function sanitizeHostname(value: string): string {
  return collapseUnderscores(value.toLowerCase().replace(/[^a-z0-9]+/g, '_')) || 'host';
}

export function fallbackBatchFolderName(startUrl: string): string {
  try {
    return `unknown-${sanitizeHostname(new URL(startUrl).hostname)}`;
  } catch {
    return 'unknown-host';
  }
}

export function resolveBatchItemFolderName(name: string, startUrl: string): string {
  const sanitizedName = sanitizeBatchItemName(name);
  return sanitizedName || fallbackBatchFolderName(startUrl);
}

export function buildBatchOutputDir(outputDir: string, name: string, startUrl: string): string {
  return path.join(outputDir, resolveBatchItemFolderName(name, startUrl));
}

export function ensureUniqueRunRoot(outputDir: string, runId: string): string {
  let runRoot = path.join(outputDir, runId);
  let suffix = 2;
  while (fs.existsSync(runRoot)) {
    runRoot = path.join(outputDir, `${runId}-r${suffix}`);
    suffix += 1;
  }
  return runRoot;
}
