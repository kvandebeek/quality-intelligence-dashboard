declare module '../src/dashboard/app/brokenLinks.js' {
  export function aggregateBrokenLinkDetails(details?: unknown[]): Array<Record<string, unknown>>;
  export function normalizeBrokenLinksReport(report?: Record<string, unknown>): { rows: Array<Record<string, unknown>>; [key: string]: unknown };
  export function renderBroken(report?: Record<string, unknown>, options?: { artifactMissing?: boolean; runId?: string }): string;
}

declare module '../src/dashboard/app/stability.js' {
  export function buildStabilityRows(samples?: Array<number | undefined>, timestamps?: string[], thresholdMs?: number, ratio?: number): Array<Record<string, unknown>>;
}
