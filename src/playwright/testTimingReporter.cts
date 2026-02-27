import path from 'node:path';
import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
  TestStep,
} from 'playwright/types/testReporter';
import { emitLog, formatTestId, getRunStartNs, nowNs, durationMsFrom } from './runtimeLogger.js';

const interestingHooks = new Set(['beforeAll', 'beforeEach', 'afterEach', 'afterAll']);

type StepRecord = {
  readonly startNs: bigint;
};

class TestTimingReporter implements Reporter {
  private rootDir = process.cwd();

  private discoveryStartNs = nowNs();

  private readonly openSteps = new Map<string, StepRecord>();

  private readonly workerFirstSeen = new Set<number>();

  public onConfigure(config: FullConfig): void {
    this.rootDir = config.rootDir;
    this.discoveryStartNs = nowNs();
    emitLog('INFO', 'runner', 'config resolved', {
      metadata: {
        workers: config.workers,
        shard: config.shard,
        grep: String(config.grep),
        grepInvert: String(config.grepInvert),
        projects: config.projects.map((project) => project.name),
      },
    });
  }

  public onBegin(config: FullConfig, suite: Suite): void {
    const discoveryDuration = durationMsFrom(this.discoveryStartNs);
    const configLoadedNs = process.env.PW_CONFIG_LOADED_NS ? BigInt(process.env.PW_CONFIG_LOADED_NS) : getRunStartNs();
    const configDurationMs = Number(configLoadedNs - getRunStartNs()) / 1_000_000;

    emitLog('INFO', 'runner', 'run started', {
      metadata: {
        workers: config.workers,
        totalTests: suite.allTests().length,
        configLoadMs: Number(configDurationMs.toFixed(3)),
        discoveryMs: Number(discoveryDuration.toFixed(3)),
      },
    });
  }

  public onTestBegin(test: TestCase, result: TestResult): void {
    const testId = this.toTestId(test, result.retry);
    const workerIndex = result.workerIndex;

    if (!this.workerFirstSeen.has(workerIndex)) {
      this.workerFirstSeen.add(workerIndex);
      emitLog('INFO', 'worker', 'worker started', { workerIndex, testId, metadata: { parallelIndex: result.parallelIndex } });
    }

    emitLog('INFO', 'test', 'test started', {
      workerIndex,
      testId,
      metadata: {
        file: path.relative(this.rootDir, test.location.file),
        title: test.title,
        retry: result.retry,
      },
    });
  }

  public onStepBegin(test: TestCase, result: TestResult, step: TestStep): void {
    const key = this.stepKey(test.id, result.retry, step.title, step.category);
    this.openSteps.set(key, { startNs: nowNs() });

    const scope = step.category === 'hook' ? 'hook' : step.category === 'pw:api' ? 'action' : 'step';
    if (scope === 'action' || scope === 'hook') {
      emitLog('DEBUG', scope, `${step.title} START`, {
        workerIndex: result.workerIndex,
        testId: this.toTestId(test, result.retry),
        metadata: { category: step.category },
      });
    }
  }

  public onStepEnd(test: TestCase, result: TestResult, step: TestStep): void {
    const key = this.stepKey(test.id, result.retry, step.title, step.category);
    const started = this.openSteps.get(key);
    this.openSteps.delete(key);

    const durationMs = started ? durationMsFrom(started.startNs) : undefined;
    const testId = this.toTestId(test, result.retry);

    if (step.category === 'hook' && interestingHooks.has(step.title)) {
      emitLog('INFO', 'hook', `${step.title} completed`, {
        workerIndex: result.workerIndex,
        testId,
        durationMs,
      });
      return;
    }

    if (step.category === 'pw:api') {
      emitLog('INFO', 'action', `${step.title} completed`, {
        workerIndex: result.workerIndex,
        testId,
        durationMs,
        metadata: { category: step.category },
      });
      return;
    }

    if (step.category === 'expect') {
      emitLog('INFO', 'step', `expect ${step.title} completed`, {
        workerIndex: result.workerIndex,
        testId,
        durationMs,
      });
    }
  }

  public onTestEnd(test: TestCase, result: TestResult): void {
    const testId = this.toTestId(test, result.retry);
    emitLog(result.status === 'passed' ? 'INFO' : 'WARN', 'test', 'test ended', {
      workerIndex: result.workerIndex,
      testId,
      durationMs: result.duration,
      metadata: {
        status: result.status,
        retry: result.retry,
        errors: result.errors.map((error) => error.message),
      },
    });
  }

  public onEnd(result: FullResult): void {
    for (const workerIndex of this.workerFirstSeen) {
      emitLog('INFO', 'worker', 'worker shutdown', { workerIndex, testId: 'worker-lifecycle' });
    }

    emitLog(result.status === 'passed' ? 'INFO' : 'WARN', 'runner', 'run completed', {
      durationMs: result.duration,
      metadata: { status: result.status },
    });
  }

  private toTestId(test: TestCase, retry: number): string {
    const file = path.relative(this.rootDir, test.location.file);
    const title = test.titlePath().slice(1).join(' > ');
    return formatTestId(file, title, retry);
  }

  private stepKey(testId: string, retry: number, stepTitle: string, category: string): string {
    return `${testId}#${retry}#${category}#${stepTitle}`;
  }
}

export = TestTimingReporter;
