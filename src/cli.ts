import { Command } from 'commander';
import { loadConfig } from './config/loadConfig.js';
import { runAssurance } from './core/runEngine.js';

const program = new Command();

program
  .name('cx-assurance')
  .description('Playwright-based CX assurance runner')
  .version('1.0.0');

program
  .command('run')
  .requiredOption('-c, --config <path>', 'Path to JSON config file')
  .action(async ({ config }) => {
    const loaded = loadConfig(config);
    const summary = await runAssurance(loaded);
    process.stdout.write(`Run completed: ${summary.metadata.runId}\n`);
  });

program.parseAsync(process.argv);
