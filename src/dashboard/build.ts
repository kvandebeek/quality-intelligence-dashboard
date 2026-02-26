import fs from 'node:fs/promises';
import path from 'node:path';

async function main(): Promise<void> {
  const targetDir = path.resolve('dist/dashboard');
  await fs.mkdir(targetDir, { recursive: true });
  await fs.cp(path.resolve('src/dashboard/app'), targetDir, { recursive: true });
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
