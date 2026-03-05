import os from 'node:os';
import path from 'node:path';

export function expandHomePath(inputPath: string, homeDir: string = os.homedir()): string {
  if (inputPath === '~') return homeDir;
  if (inputPath.startsWith('~/') || inputPath.startsWith('~\\')) {
    return path.join(homeDir, inputPath.slice(2));
  }
  return inputPath;
}

export function resolveArtifactLocalPath(baseDir: string, artifactKey: string): string {
  const decodedKey = decodeURIComponent(artifactKey);
  const segments = decodedKey
    .split(/[\\/]+/)
    .filter((segment) => segment.length > 0)
    .filter((segment) => segment !== '.');
  return path.join(baseDir, ...segments);
}

