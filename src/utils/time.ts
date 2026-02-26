export function compactTimestamp(date = new Date()): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

export function stableRunId(timestamp: string, browser: string, iteration: number, name?: string): string {
  const baseRunId = `${timestamp}-${browser}-it${iteration}`;

  if (!name) {
    return baseRunId;
  }

  return `${name}-${baseRunId}`;
}
