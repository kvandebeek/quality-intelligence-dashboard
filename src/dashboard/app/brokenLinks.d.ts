export function aggregateBrokenLinkDetails(details?: unknown[]): Array<Record<string, unknown>>;
export function bindBrokenLinks(scope: HTMLElement): void;
export function normalizeBrokenLinkRow(raw: Record<string, unknown>): Record<string, unknown> | null;
export function normalizeBrokenLinksReport(report?: Record<string, unknown>): Record<string, unknown>;
export function renderBroken(report?: Record<string, unknown>, options?: { artifactMissing?: boolean; runId?: string }): string;
