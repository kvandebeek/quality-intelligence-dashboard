import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
  TestStep,
  TestStatus,
} from 'playwright/types/testReporter';

const DEFAULT_SLOW_TEST_THRESHOLD_MS = 5000;
const DEFAULT_LOG_STEPS = false;
const DEFAULT_LOG_SLOWEST_N = 10;
const ARTIFACTS_DIR = 'artifacts';
const TEST_TIMING_FILE_NAME = 'test-timing.json';
const STEP_CATEGORY = 'test.step';

type PersistedStatus = 'passed' | 'failed' | 'skipped' | 'timedOut';

type Milliseconds = number;

type TimingStep = {
  readonly name: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly durationMs: Milliseconds;
  readonly parentTestId: string;
};

type TimingTest = {
  readonly id: string;
  readonly file: string;
  readonly testName: string;
  readonly status: PersistedStatus;
  readonly retry: number;
  readonly startTime: string;
  readonly endTime: string;
  readonly durationMs: Milliseconds;
  readonly isSlow: boolean;
  readonly steps: readonly TimingStep[];
};

type TimingSuite = {
  readonly startTime: string;
  readonly endTime: string;
  readonly durationMs: Milliseconds;
  readonly totalTests: number;
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
};

type TestTimingArtifact = {
  readonly runId: string;
  readonly suite: TimingSuite;
  readonly tests: readonly TimingTest[];
  readonly config: {
    readonly slowTestThresholdMs: number;
    readonly logTestSteps: boolean;
    readonly logSlowestN: number;
  };
};

type MutableStep = {
  readonly startTime: Date;
};

type MutableTestRecord = {
  readonly id: string;
  readonly file: string;
  readonly testName: string;
  readonly startTime: Date;
  endTime?: Date;
  status?: PersistedStatus;
  retry?: number;
  durationMs?: Milliseconds;
  steps: TimingStep[];
  openSteps: Map<TestStep, MutableStep>;
};

const parsePositiveIntegerEnv = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
};

const parseBooleanEnv = (value: string | undefined, fallback: boolean): boolean => {
  if (!value) {
    return fallback;
  }

  return value.toLowerCase() === 'true';
};

const toIsoString = (value: Date): string => value.toISOString();

const formatSeconds = (durationMs: number): string => `${(durationMs / 1000).toFixed(2)}s`;

const withPadding = (value: string, width: number): string => value.padEnd(width, ' ');

const shortenFilePath = (absolutePath: string, rootDir: string): string => {
  const relativePath = path.relative(rootDir, absolutePath);
  return relativePath || absolutePath;
};

const resolveStatus = (status: TestStatus): PersistedStatus => {
  if (status === 'passed') {
    return 'passed';
  }

  if (status === 'skipped') {
    return 'skipped';
  }

  if (status === 'timedOut') {
    return 'timedOut';
  }

  return 'failed';
};

const statusLabel = (status: PersistedStatus): string => {
  if (status === 'passed') {
    return 'PASS';
  }

  if (status === 'failed') {
    return 'FAIL';
  }

  if (status === 'skipped') {
    return 'SKIP';
  }

  return 'TIMEOUT';
};

class TestTimingReporter implements Reporter {
  private readonly runId: string;

  private readonly slowTestThresholdMs: number;

  private readonly logTestSteps: boolean;

  private readonly logSlowestN: number;

  private rootDir: string;

  private suiteStartTime: Date;

  private readonly tests = new Map<string, MutableTestRecord>();

  public constructor() {
    this.runId = `${Date.now()}`;
    this.slowTestThresholdMs = parsePositiveIntegerEnv(
      process.env.SLOW_TEST_THRESHOLD_MS,
      DEFAULT_SLOW_TEST_THRESHOLD_MS,
    );
    this.logTestSteps = parseBooleanEnv(process.env.LOG_TEST_STEPS, DEFAULT_LOG_STEPS);
    this.logSlowestN = parsePositiveIntegerEnv(process.env.LOG_SLOWEST_N, DEFAULT_LOG_SLOWEST_N);
    this.rootDir = process.cwd();
    this.suiteStartTime = new Date();
  }

  public onBegin(config: FullConfig, suite: Suite): void {
    this.rootDir = config.rootDir;
    this.suiteStartTime = new Date();
    const totalTests = suite.allTests().length;
    process.stdout.write(`\nTIMING RUN ${this.runId} | tests=${totalTests}\n`);
  }

  public onTestBegin(test: TestCase, result: TestResult): void {
    const key = this.recordKey(test.id, result.retry);
    this.tests.set(key, {
      id: key,
      file: shortenFilePath(test.location.file, this.rootDir),
      testName: test.titlePath().slice(1).join(' › '),
      startTime: new Date(),
      steps: [],
      openSteps: new Map<TestStep, MutableStep>(),
    });
  }

  public onStepBegin(test: TestCase, result: TestResult, step: TestStep): void {
    if (step.category !== STEP_CATEGORY) {
      return;
    }

    const record = this.tests.get(this.recordKey(test.id, result.retry));
    if (!record) {
      return;
    }

    record.openSteps.set(step, {
      startTime: new Date(),
    });
  }

  public onStepEnd(test: TestCase, result: TestResult, step: TestStep): void {
    if (step.category !== STEP_CATEGORY) {
      return;
    }

    const record = this.tests.get(this.recordKey(test.id, result.retry));
    if (!record) {
      return;
    }

    const startedStep = record.openSteps.get(step);
    const endTime = new Date();
    const startTime = startedStep?.startTime ?? endTime;
    const durationMs = Math.max(endTime.getTime() - startTime.getTime(), 0);

    record.openSteps.delete(step);
    record.steps.push({
      name: step.title,
      startTime: toIsoString(startTime),
      endTime: toIsoString(endTime),
      durationMs,
      parentTestId: record.id,
    });
  }

  public onTestEnd(test: TestCase, result: TestResult): void {
    const key = this.recordKey(test.id, result.retry);
    const record = this.tests.get(key);
    if (!record) {
      return;
    }

    const endTime = new Date();
    const durationMs = Math.max(endTime.getTime() - record.startTime.getTime(), 0);
    const status = resolveStatus(result.status);
    const persisted: MutableTestRecord = {
      ...record,
      endTime,
      durationMs,
      status,
      retry: result.retry,
    };
    this.tests.set(key, persisted);

    process.stdout.write(
      `${withPadding(statusLabel(status), 7)} ${withPadding(formatSeconds(durationMs), 8)} ${record.testName} (${record.file})${result.retry > 0 ? ` retry=${result.retry}` : ''}\n`,
    );

    if (this.logTestSteps && record.steps.length > 0) {
      for (const step of record.steps) {
        process.stdout.write(`  STEP ${withPadding(formatSeconds(step.durationMs), 8)} ${step.name}\n`);
      }
    }
  }

  public async onEnd(result: FullResult): Promise<void> {
    const suiteEndTime = new Date();
    const artifact = this.buildArtifact(suiteEndTime);
    const outputDir = path.join(this.rootDir, ARTIFACTS_DIR, this.runId);

    try {
      await mkdir(outputDir, { recursive: true });
      await writeFile(path.join(outputDir, TEST_TIMING_FILE_NAME), `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown write error';
      process.stderr.write(`Failed to write timing artifact: ${message}\n`);
    }

    this.printSummary(artifact, result.status);
  }

  private buildArtifact(suiteEndTime: Date): TestTimingArtifact {
    const tests = [...this.tests.values()]
      .filter((record): record is MutableTestRecord & Required<Pick<MutableTestRecord, 'endTime' | 'durationMs' | 'status' | 'retry'>> => {
        return (
          typeof record.durationMs === 'number' &&
          typeof record.retry === 'number' &&
          typeof record.status === 'string' &&
          record.endTime instanceof Date
        );
      })
      .map((record): TimingTest => ({
        id: record.id,
        file: record.file,
        testName: record.testName,
        status: record.status,
        retry: record.retry,
        startTime: toIsoString(record.startTime),
        endTime: toIsoString(record.endTime),
        durationMs: record.durationMs,
        isSlow: record.durationMs >= this.slowTestThresholdMs,
        steps: record.steps,
      }));

    const passed = tests.filter((test) => test.status === 'passed').length;
    const failed = tests.filter((test) => test.status === 'failed' || test.status === 'timedOut').length;
    const skipped = tests.filter((test) => test.status === 'skipped').length;

    return {
      runId: this.runId,
      suite: {
        startTime: toIsoString(this.suiteStartTime),
        endTime: toIsoString(suiteEndTime),
        durationMs: Math.max(suiteEndTime.getTime() - this.suiteStartTime.getTime(), 0),
        totalTests: tests.length,
        passed,
        failed,
        skipped,
      },
      tests,
      config: {
        slowTestThresholdMs: this.slowTestThresholdMs,
        logTestSteps: this.logTestSteps,
        logSlowestN: this.logSlowestN,
      },
    };
  }

  private printSummary(artifact: TestTimingArtifact, runStatus: FullResult['status']): void {
    const sortedByDuration = [...artifact.tests].sort((left, right) => right.durationMs - left.durationMs);
    const slowest = sortedByDuration.slice(0, this.logSlowestN);

    process.stdout.write('\n=== Test Timing Summary ===\n');
    process.stdout.write(`Run ID: ${artifact.runId}\n`);
    process.stdout.write(`Suite status: ${runStatus}\n`);
    process.stdout.write(`Total duration: ${formatSeconds(artifact.suite.durationMs)} (${artifact.suite.durationMs}ms)\n`);
    process.stdout.write(`Total tests: ${artifact.suite.totalTests}\n`);
    process.stdout.write(
      `Passed/Failed/Skipped: ${artifact.suite.passed}/${artifact.suite.failed}/${artifact.suite.skipped}\n`,
    );
    process.stdout.write(`Slow test threshold: ${this.slowTestThresholdMs}ms\n`);
    process.stdout.write(`Artifact: ${path.join(ARTIFACTS_DIR, artifact.runId, TEST_TIMING_FILE_NAME)}\n`);

    if (slowest.length > 0) {
      process.stdout.write(`Slowest ${slowest.length} tests:\n`);
      for (const test of slowest) {
        const slowMarker = test.isSlow ? ' SLOW' : '';
        process.stdout.write(
          `  - ${withPadding(formatSeconds(test.durationMs), 8)} ${test.testName} (${test.file})${slowMarker}\n`,
        );
      }
    }

    process.stdout.write('===========================\n\n');
  }

  private recordKey(testId: string, retry: number): string {
    return `${testId}#${retry}`;
  }
}

export = TestTimingReporter;
