import { Command } from 'commander';
import { loadRunPlan } from './config/loadConfig.js';
import { runAssurance } from './core/runEngine.js';
import { executeBatchRuns } from './core/runBatch.js';

const program = new Command();

program
  .name('quality-signal')
  .description('Playwright-based quality automation runner')
  .version('1.0.0');

program
  .command('run')
  .requiredOption('-c, --config <path>', 'Path to JSON config file')
  .action(async ({ config }) => {
    process.stdout.write(`Starting run with config: ${config}\n`);
    const plan = loadRunPlan(config);

    if (plan.kind === 'single') {
      process.stdout.write(`Target: ${plan.config.startUrl}\n`);
      const summary = await runAssurance(plan.config);
      process.stdout.write(`Run completed: ${summary.metadata.runId}\n`);
      return;
    }

    process.stdout.write(`Batch run: ${plan.runs.length} targets\n`);
    plan.runs.forEach((run) => {
      process.stdout.write(`[${run.index}/${run.total}] ${run.name} | ${run.startUrl} | output: ${run.config.outputDir}\n`);
    });

    const result = await executeBatchRuns(plan.runs, async (effectiveConfig) => {
      const current = plan.runs.find((run) => run.config === effectiveConfig);
      if (current) {
        process.stdout.write(`\nRunning [${current.index}/${current.total}] ${current.name}\n`);
      }
      return runAssurance(effectiveConfig);
    });

    process.stdout.write('\nBatch summary:\n');
    result.statuses.forEach((entry) => {
      const detail = entry.status === 'pass'
        ? `runId=${entry.summary?.metadata.runId ?? 'unknown'}`
        : `error=${entry.error ?? 'unknown error'}`;
      process.stdout.write(`- [${entry.run.index}/${entry.run.total}] ${entry.run.name}: ${entry.status.toUpperCase()} (${detail})\n`);
    });
    process.stdout.write(`Total elapsed: ${result.elapsedMs}ms\n`);

    if (result.statuses.some((entry) => entry.status === 'fail')) {
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv);
