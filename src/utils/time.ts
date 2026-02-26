export function compactTimestamp(date = new Date()): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

export function stableRunId(timestamp: string, browser: string, iteration: number): string {
  return `${timestamp}-${browser}-it${iteration}`;
}
