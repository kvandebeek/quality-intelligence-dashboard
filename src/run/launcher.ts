import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline/promises';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

interface LauncherOptions {
  config?: string;
  listOnly: boolean;
  help: boolean;
}

const RUNS_USAGE = `Usage: npm run runs -- [options]\n\nOptions:\n  --config <path>   Launch src/cli.ts run with the selected config path\n  --list            List discoverable configs and exit\n  -h, --help        Show this help message\n`;

function printUsage(): void {
  process.stdout.write(RUNS_USAGE);
}

interface DiscoveredConfig {
  name: string;
  absolutePath: string;
  relativePath: string;
}

const require = createRequire(import.meta.url);

async function findRepoRoot(startDir: string): Promise<string> {
  let current = path.resolve(startDir);

  while (true) {
    const packageJsonPath = path.join(current, 'package.json');
    try {
      await fs.access(packageJsonPath);
      return current;
    } catch {
      // Continue traversing upward.
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return path.resolve(startDir);
    }
    current = parent;
  }
}

function parseArgs(argv: readonly string[]): LauncherOptions {
  const options: LauncherOptions = { listOnly: false, help: false };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--list') {
      options.listOnly = true;
      continue;
    }

    if (arg === '-h' || arg === '--help') {
      options.help = true;
      continue;
    }

    if (arg === '--config') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('Missing value for --config. Usage: --config <path>');
      }
      options.config = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}\n\n${RUNS_USAGE}`);
  }

  return options;
}

async function discoverConfigs(configDir: string, repoRoot: string): Promise<{ configs: DiscoveredConfig[]; usingFallbackJson: boolean }> {
  const entries = await fs.readdir(configDir, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);

  const primary = files.filter((name) => name.toLowerCase().endsWith('.config.json'));
  const fallback = files.filter((name) => name.toLowerCase().endsWith('.json'));

  const selectedNames = primary.length > 0 ? primary : fallback;

  selectedNames.sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'accent' }));

  const configs = selectedNames.map((name) => {
    const absolutePath = path.join(configDir, name);
    return {
      name,
      absolutePath,
      relativePath: path.relative(repoRoot, absolutePath)
    };
  });

  return {
    configs,
    usingFallbackJson: primary.length === 0 && fallback.length > 0
  };
}

function printConfigList(configs: readonly DiscoveredConfig[], usingFallbackJson: boolean): void {
  process.stdout.write('Available configs in config/:\n');
  if (usingFallbackJson) {
    process.stdout.write("No '*.config.json' files found; listing '*.json' files instead.\n");
  }

  configs.forEach((config, index) => {
    process.stdout.write(`${index + 1}) ${config.name}\n`);
  });
}

async function promptForSelection(configs: readonly DiscoveredConfig[]): Promise<DiscoveredConfig | null> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    while (true) {
      const input = (await rl.question("Enter a number (or 'q' to quit): ")).trim();
      const lowered = input.toLowerCase();

      if (input === '' || lowered === 'q' || lowered === 'quit') {
        return null;
      }

      const parsed = Number(input);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > configs.length) {
        process.stderr.write(`Invalid selection \"${input}\". Enter a number from 1 to ${configs.length}, or 'q' to quit.\n`);
        continue;
      }

      return configs[parsed - 1];
    }
  } finally {
    rl.close();
  }
}

async function validateJsonConfig(configPath: string): Promise<void> {
  const raw = await fs.readFile(configPath, 'utf8');
  try {
    JSON.parse(raw);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse JSON config ${configPath}: ${message}`);
  }
}

async function launchRun(repoRoot: string, configPath: string): Promise<number> {
  const tsxCliPath = require.resolve('tsx/dist/cli.mjs');
  const cliPath = path.join(repoRoot, 'src', 'cli.ts');

  return new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, [tsxCliPath, cliPath, 'run', '--config', configPath], {
      cwd: repoRoot,
      stdio: 'inherit'
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (signal) {
        resolve(1);
        return;
      }
      resolve(code ?? 0);
    });
  });
}

function normalizeConfigPath(inputPath: string, repoRoot: string): { absolutePath: string; relativePath: string } {
  const absolutePath = path.isAbsolute(inputPath)
    ? path.normalize(inputPath)
    : path.resolve(repoRoot, inputPath);

  return {
    absolutePath,
    relativePath: path.relative(repoRoot, absolutePath)
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }
  const repoRoot = await findRepoRoot(process.cwd());
  const configDir = path.join(repoRoot, 'config');

  const configDirStats = await fs.stat(configDir).catch(() => null);
  if (!configDirStats || !configDirStats.isDirectory()) {
    throw new Error(`Missing config directory: ${configDir}. Add config/*.config.json files and retry.`);
  }

  const { configs, usingFallbackJson } = await discoverConfigs(configDir, repoRoot);

  if (configs.length === 0) {
    process.stderr.write("No config files found in config/. Add files matching config/*.config.json and retry.\n");
    process.exitCode = 1;
    return;
  }

  if (options.listOnly) {
    printConfigList(configs, usingFallbackJson);
    return;
  }

  let selected: DiscoveredConfig | null = null;

  if (options.config) {
    const normalized = normalizeConfigPath(options.config, repoRoot);
    selected = {
      name: path.basename(normalized.absolutePath),
      absolutePath: normalized.absolutePath,
      relativePath: normalized.relativePath
    };
  } else {
    printConfigList(configs, usingFallbackJson);
    selected = await promptForSelection(configs);

    if (!selected) {
      process.stdout.write('No config selected. Exiting.\n');
      return;
    }
  }

  const selectedStats = await fs.stat(selected.absolutePath).catch(() => null);
  if (!selectedStats || !selectedStats.isFile()) {
    process.stderr.write(`Config file not found: ${selected.relativePath}\n`);
    process.exitCode = 1;
    return;
  }

  await validateJsonConfig(selected.absolutePath);

  const displayPath = selected.relativePath.split(path.sep).join('/');
  process.stdout.write(`Starting run with config: ${displayPath}\n`);

  const exitCode = await launchRun(repoRoot, selected.absolutePath);
  process.exitCode = exitCode;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`runs failed: ${message}\n`);
  process.exitCode = 1;
});
