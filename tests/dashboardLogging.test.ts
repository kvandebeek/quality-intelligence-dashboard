import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AppLogger } from '../src/dashboard/logging.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe('dashboard logging', () => {
  it('initializes and writes structured logs to file', async () => {
    const logDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dashboard-logs-'));
    tempDirs.push(logDir);

    const logger = new AppLogger({
      appVersion: '1.0.0',
      buildId: 'test-build',
      runId: 'test-run-id',
      level: 'DEBUG',
      logDir
    });

    await logger.initialize();
    logger.info('test event', { operationId: 'op-1', token: 'hidden' });

    await new Promise((resolve) => setTimeout(resolve, 30));

    const files = await fs.readdir(logDir);
    const logFile = files.find((file) => file.endsWith('.jsonl'));
    expect(logFile).toBeTruthy();

    const contents = await fs.readFile(path.join(logDir, logFile ?? ''), 'utf8');
    expect(contents).toContain('test event');
    expect(contents).toContain('"runId":"test-run-id"');
    expect(contents).toContain('"token":"[REDACTED]"');
  });
});
