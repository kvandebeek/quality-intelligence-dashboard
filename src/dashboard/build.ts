import fs from 'node:fs/promises';
import path from 'node:path';

async function main(): Promise<void> {
  const source = path.resolve('src/dashboard/styles.css');
  const targetDir = path.resolve('dist/dashboard');
  await fs.mkdir(targetDir, { recursive: true });
  await fs.copyFile(source, path.join(targetDir, 'styles.css'));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
