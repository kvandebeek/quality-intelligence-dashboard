import type { BatchExpandedRun } from '../config/loadConfig.js';
import type { AppConfig, RunSummary } from '../models/types.js';

export interface BatchRunStatus {
  run: BatchExpandedRun;
  status: 'pass' | 'fail';
  summary?: RunSummary;
  error?: string;
}

export interface BatchRunResult {
  statuses: BatchRunStatus[];
  elapsedMs: number;
}

export async function executeBatchRuns(
  runs: BatchExpandedRun[],
  runner: (config: AppConfig) => Promise<RunSummary>
): Promise<BatchRunResult> {
  const startedAt = Date.now();
  const statuses: BatchRunStatus[] = [];

  for (const run of runs) {
    try {
      const summary = await runner(run.config);
      statuses.push({ run, status: 'pass', summary });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      statuses.push({ run, status: 'fail', error: message });
    }
  }

  return {
    statuses,
    elapsedMs: Date.now() - startedAt
  };
}
