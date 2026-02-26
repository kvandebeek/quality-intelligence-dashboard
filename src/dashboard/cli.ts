import { parseArgs } from 'node:util';
import { loadDashboardRun, resolveRunPath, toOverviewRows } from './data.js';

async function main(): Promise<void> {
  const parsed = parseArgs({
    options: {
      run: { type: 'string' }
    }
  });

  const runPath = resolveRunPath({ cliRunPath: parsed.values.run, envRunPath: process.env.ARTIFACT_RUN_DIR });
  const run = await loadDashboardRun(runPath);
  const rows = toOverviewRows(run);
  const failedPages = rows.filter((row) => row.failedRequestCount > 0).length;
  process.stdout.write(`Run path: ${runPath}\n`);
  process.stdout.write(`Pages: ${rows.length}\n`);
  process.stdout.write(`Pages with network failures: ${failedPages}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
