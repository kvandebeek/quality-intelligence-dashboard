import fs from 'node:fs/promises';
import path from 'node:path';

async function main(): Promise<void> {
  const source = path.resolve('src/dashboard/styles.css');
  const stylesDir = path.resolve('src/dashboard/styles');
  const targetDir = path.resolve('dist/dashboard');
  const targetStylesDir = path.join(targetDir, 'styles');
  await fs.mkdir(targetDir, { recursive: true });
  await fs.mkdir(targetStylesDir, { recursive: true });
  await fs.copyFile(source, path.join(targetDir, 'styles.css'));
  await fs.cp(stylesDir, targetStylesDir, { recursive: true });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
