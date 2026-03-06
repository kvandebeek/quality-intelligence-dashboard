import process from 'node:process';

type PhaseState = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface PageProgressPhase {
  readonly id: string;
  readonly label: string;
  readonly weight: number;
  readonly expectedDurationMs?: number;
}

export interface PageProgressOptions {
  readonly pageLabel: string;
  readonly pageUrl?: string;
  readonly pageIndex?: number;
  readonly totalPages?: number;
  readonly phases: readonly PageProgressPhase[];
  readonly now?: () => number;
  readonly stream?: NodeJS.WriteStream;
}

const BAR_WIDTH = 18;
const UNKNOWN_PHASE_CAP = 0.9;
const LIVE_REFRESH_MS = 250;
const MAX_URL_LENGTH = 72;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export class PageProgressLogger {
  private readonly stream: NodeJS.WriteStream;

  private readonly now: () => number;

  private readonly interactive: boolean;

  private readonly phases: readonly PageProgressPhase[];

  private readonly pageLabel: string;

  private readonly pageUrl?: string;

  private readonly pageIndex?: number;

  private readonly totalPages?: number;

  private readonly runStartedMs: number;

  private phaseStates = new Map<string, PhaseState>();

  private activePhaseId: string | null = null;

  private activePhaseStartedAt: number | null = null;

  private lastRenderAt = 0;

  private tickTimer: NodeJS.Timeout | null = null;

  public constructor(options: PageProgressOptions) {
    this.stream = options.stream ?? process.stdout;
    this.now = options.now ?? (() => Date.now());
    this.interactive = Boolean(this.stream.isTTY && process.env.CI !== 'true');
    this.pageLabel = options.pageLabel;
    this.pageUrl = options.pageUrl;
    this.pageIndex = options.pageIndex;
    this.totalPages = options.totalPages;
    this.phases = options.phases.filter((phase) => phase.weight > 0);
    this.runStartedMs = this.now();

    for (const phase of this.phases) {
      this.phaseStates.set(phase.id, 'pending');
    }
  }

  public start(): void {
    this.render('starting');
  }

  public startPhase(phaseId: string): void {
    if (!this.phaseStates.has(phaseId)) {
      return;
    }

    if (this.activePhaseId && this.phaseStates.get(this.activePhaseId) === 'running') {
      this.phaseStates.set(this.activePhaseId, 'completed');
    }

    this.activePhaseId = phaseId;
    this.activePhaseStartedAt = this.now();
    this.phaseStates.set(phaseId, 'running');
    this.ensureTicking();
    this.render(this.phaseLabel(phaseId));
  }

  public completePhase(phaseId: string): void {
    if (!this.phaseStates.has(phaseId)) {
      return;
    }

    this.phaseStates.set(phaseId, 'completed');
    if (this.activePhaseId === phaseId) {
      this.activePhaseId = null;
      this.activePhaseStartedAt = null;
      this.clearTicking();
    }

    this.render(this.phaseLabel(phaseId));
  }

  public skipPhase(phaseId: string, reason?: string): void {
    if (!this.phaseStates.has(phaseId)) {
      return;
    }

    this.phaseStates.set(phaseId, 'skipped');
    if (this.activePhaseId === phaseId) {
      this.activePhaseId = null;
      this.activePhaseStartedAt = null;
    }

    this.render(reason ? `${this.phaseLabel(phaseId)} (skipped: ${reason})` : `${this.phaseLabel(phaseId)} (skipped)`);
  }

  public fail(phaseId: string | null, message?: string): void {
    if (phaseId && this.phaseStates.has(phaseId)) {
      this.phaseStates.set(phaseId, 'failed');
      this.activePhaseId = null;
      this.activePhaseStartedAt = null;
    }

    this.clearTicking();
    this.finalizeLine('FAIL', message);
  }

  public complete(status: 'PASS' | 'SKIP' | 'TIMEOUT' = 'PASS'): void {
    this.clearTicking();
    for (const phase of this.phases) {
      const state = this.phaseStates.get(phase.id);
      if (state === 'pending' || state === 'running') {
        this.phaseStates.set(phase.id, 'completed');
      }
    }

    this.finalizeLine(status);
  }

  private ensureTicking(): void {
    if (!this.interactive || this.tickTimer) {
      return;
    }

    this.tickTimer = setInterval(() => {
      this.render(this.activePhaseId ? this.phaseLabel(this.activePhaseId) : 'running');
    }, LIVE_REFRESH_MS);
    this.tickTimer.unref();
  }

  private clearTicking(): void {
    if (!this.tickTimer) {
      return;
    }

    clearInterval(this.tickTimer);
    this.tickTimer = null;
  }

  private phaseLabel(phaseId: string): string {
    return this.phases.find((phase) => phase.id === phaseId)?.label ?? phaseId;
  }

  private calculateProgressFraction(): number {
    const totalWeight = this.phases.reduce((sum, phase) => sum + phase.weight, 0);
    if (totalWeight <= 0) {
      return 0;
    }

    let doneWeight = 0;

    for (const phase of this.phases) {
      const state = this.phaseStates.get(phase.id) ?? 'pending';
      if (state === 'completed' || state === 'skipped') {
        doneWeight += phase.weight;
        continue;
      }

      if (state === 'failed') {
        doneWeight += phase.weight;
        continue;
      }

      if (state === 'running' && this.activePhaseId === phase.id && this.activePhaseStartedAt) {
        const expected = Math.max(phase.expectedDurationMs ?? 6000, 1000);
        const elapsed = Math.max(this.now() - this.activePhaseStartedAt, 0);
        const fraction = clamp(elapsed / expected, 0.05, UNKNOWN_PHASE_CAP);
        doneWeight += phase.weight * fraction;
      }
    }

    return clamp(doneWeight / totalWeight, 0, 1);
  }

  private render(phaseDescription: string): void {
    const nowMs = this.now();
    if (!this.interactive && nowMs - this.lastRenderAt < 1000) {
      return;
    }

    const fraction = this.calculateProgressFraction();
    const percent = Math.round(fraction * 100);
    const filled = Math.round(fraction * BAR_WIDTH);
    const bar = `[${'█'.repeat(filled)}${'░'.repeat(Math.max(BAR_WIDTH - filled, 0))}]`;
    const pageCounter = this.formatPageCounter();
    const identity = this.formatIdentity();
    const line = `${pageCounter} | ${identity} ${bar} ${String(percent).padStart(3, ' ')}% | Phase: ${phaseDescription}`;

    if (this.interactive) {
      this.stream.write(`\r\x1b[2K${line}`);
    } else {
      this.stream.write(`${line}\n`);
    }

    this.lastRenderAt = nowMs;
  }

  private finalizeLine(status: string, extra?: string): void {
    const elapsedMs = Math.max(this.now() - this.runStartedMs, 0);
    const seconds = (elapsedMs / 1000).toFixed(1);
    const pageCounter = this.formatPageCounter();
    const identity = this.pageUrl ? this.pageUrl : this.pageLabel;
    const suffix = extra ? ` | ${extra}` : '';
    const line = `${status} | ${seconds}s | ${pageCounter} | ${identity}${suffix}`;

    if (this.interactive) {
      this.stream.write(`\r\x1b[2K${line}\n`);
    } else {
      this.stream.write(`${line}\n`);
    }
  }

  private formatPageCounter(): string {
    if (this.pageIndex && this.totalPages) {
      return `${this.pageLabel} ${this.pageIndex}/${this.totalPages}`;
    }

    if (this.pageIndex) {
      return `${this.pageLabel} ${this.pageIndex}`;
    }

    return this.pageLabel;
  }

  private formatIdentity(): string {
    if (!this.pageUrl) {
      return this.pageLabel;
    }

    if (this.pageUrl.length <= MAX_URL_LENGTH) {
      return this.pageUrl;
    }

    return `${this.pageUrl.slice(0, MAX_URL_LENGTH - 1)}…`;
  }
}
