import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline/promises';
import { spawn } from 'node:child_process';
import { startDashboardServer } from './server.js';



async function openInDefaultBrowser(url: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const isWindows = process.platform === 'win32';
    const command = isWindows ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    const args = isWindows ? ['/c', 'start', '', url] : [url];
    const child = spawn(command, args, {
      stdio: 'ignore',
      detached: !isWindows
    });
    child.on('error', reject);
    child.on('spawn', () => {
      if (!isWindows) child.unref();
      resolve();
    });
  });
}

interface RunEntry {
  name: string;
  runPath: string;
  modifiedAt: Date;
  modifiedAtMs: number;
}

function formatTimestamp(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

async function loadRunEntries(artifactsRoot: string): Promise<RunEntry[]> {
  const dirEntries = await fs.readdir(artifactsRoot, { withFileTypes: true });
  const candidates = dirEntries
    .filter((entry) => entry.isDirectory())
    .filter((entry) => !entry.name.startsWith('.'));

  const runEntries = await Promise.all(
    candidates.map(async (entry): Promise<RunEntry> => {
      const runPath = path.join(artifactsRoot, entry.name);
      const stats = await fs.stat(runPath);
      return {
        name: entry.name,
        runPath,
        modifiedAt: stats.mtime,
        modifiedAtMs: stats.mtimeMs
      };
    })
  );

  runEntries.sort((left, right) => {
    if (right.modifiedAtMs !== left.modifiedAtMs) {
      return right.modifiedAtMs - left.modifiedAtMs;
    }
    return left.name.localeCompare(right.name);
  });

  return runEntries;
}

async function promptForSelection(runEntries: readonly RunEntry[]): Promise<RunEntry | null> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    while (true) {
      const input = (await rl.question("Select a run number (or 'q' to quit): ")).trim();
      if (input.toLowerCase() === 'q') {
        return null;
      }

      const parsed = Number(input);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > runEntries.length) {
        process.stderr.write(`Invalid selection "${input}". Enter a number from 1 to ${runEntries.length}, or 'q' to quit.\n`);
        continue;
      }

      return runEntries[parsed - 1];
    }
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const artifactsRoot = path.resolve(process.cwd(), 'artifacts');

  const artifactsStats = await fs.stat(artifactsRoot).catch(() => null);
  if (!artifactsStats || !artifactsStats.isDirectory()) {
    throw new Error(`Missing artifacts directory: ${artifactsRoot}`);
  }

  const runEntries = await loadRunEntries(artifactsRoot);
  if (runEntries.length === 0) {
    throw new Error(`No run folders found in ${artifactsRoot}`);
  }

  process.stdout.write(`Available runs in ${artifactsRoot}:\n`);
  runEntries.forEach((entry, index) => {
    process.stdout.write(`${index + 1}) ${entry.name} (modified ${formatTimestamp(entry.modifiedAt)})\n`);
  });

  const selectedRun = await promptForSelection(runEntries);
  if (!selectedRun) {
    process.stdout.write('No run selected. Exiting.\n');
    return;
  }

  const started = await startDashboardServer({
    runPath: selectedRun.runPath,
    port: 4173
  });

  process.stdout.write(`Selected run: ${selectedRun.name}\n`);
  process.stdout.write(`Dashboard started at ${started.url}\n`);

  await openInDefaultBrowser(started.url);
  process.stdout.write(`Opened browser to ${started.url}\n`);

  let isShuttingDown = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    process.stdout.write(`Received ${signal}; shutting down dashboard server...\n`);
    started.close()
      .then(() => {
        process.exit(0);
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`Failed to close dashboard server: ${message}\n`);
        process.exit(1);
      });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`dashboards failed: ${message}\n`);
  process.exitCode = 1;
});
