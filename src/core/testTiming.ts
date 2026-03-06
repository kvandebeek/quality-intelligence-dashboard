import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { PageProgressLogger, type PageProgressPhase } from './pageProgressLogger.js';

const TEST_TIMING_FILE_NAME = 'test-timing.json';
const DEFAULT_SLOW_TEST_THRESHOLD_MS = 5000;
const DEFAULT_LOG_TEST_STEPS = false;
const DEFAULT_LOG_SLOWEST_N = 10;
const DEFAULT_LIVE_LOGGING = true;

type TestStatus = 'passed' | 'failed' | 'skipped' | 'timedOut';

type TimingStep = {
  readonly name: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly durationMs: number;
  readonly parentTestReference: string;
};

type TimingTest = {
  readonly reference: string;
  readonly file: string;
  readonly testName: string;
  readonly status: TestStatus;
  readonly retry: number;
  readonly startTime: string;
  readonly endTime: string;
  readonly durationMs: number;
  readonly isSlow: boolean;
  readonly steps: readonly TimingStep[];
};

type TimingSuite = {
  readonly startTime: string;
  readonly endTime: string;
  readonly durationMs: number;
  readonly totalTests: number;
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
};

export type TestTimingArtifact = {
  readonly runId: string;
  readonly suite: TimingSuite;
  readonly tests: readonly TimingTest[];
  readonly config: {
    readonly slowTestThresholdMs: number;
    readonly logTestSteps: boolean;
    readonly logSlowestN: number;
  };
};

type TestRecordMutable = {
  readonly reference: string;
  readonly file: string;
  readonly testName: string;
  readonly retry: number;
  readonly start: number;
  readonly steps: TimingStep[];
  readonly progress: PageProgressLogger;
  activePhaseId?: string;
  status?: TestStatus;
  end?: number;
};

type StartTestOptions = {
  readonly pageUrl?: string;
  readonly pageIndex?: number;
  readonly totalPages?: number;
};

const PAGE_PROGRESS_PHASES: readonly PageProgressPhase[] = [
  { id: 'setup', label: 'setup', weight: 8, expectedDurationMs: 2500 },
  { id: 'navigation', label: 'navigation', weight: 14, expectedDurationMs: 5500 },
  { id: 'core-artifacts', label: 'core artifacts', weight: 18, expectedDurationMs: 9000 },
  { id: 'security', label: 'security', weight: 11, expectedDurationMs: 4500 },
  { id: 'broken-links', label: 'broken-links', weight: 12, expectedDurationMs: 9000 },
  { id: 'seo', label: 'seo', weight: 8, expectedDurationMs: 3500 },
  { id: 'stability', label: 'stability', weight: 10, expectedDurationMs: 4500 },
  { id: 'extensions', label: 'extensions', weight: 8, expectedDurationMs: 3500 },
  { id: 'ux', label: 'ux', weight: 6, expectedDurationMs: 5000 },
  { id: 'persistence', label: 'persistence', weight: 3, expectedDurationMs: 1800 },
  { id: 'teardown', label: 'teardown', weight: 2, expectedDurationMs: 1200 },
];

const phaseFromStepName = (stepName: string): string => {
  const normalized = stepName.toLowerCase();

  if (normalized.includes('close browser context')) return 'teardown';
  if (normalized.includes('write target summary')) return 'persistence';
  if (normalized.includes('ux suite')) return 'ux';
  if (normalized.includes('extension:')) return 'extensions';
  if (normalized.includes('stability') || normalized.includes('cross-browser') || normalized.includes('memory growth') || normalized.includes('focus-trap') || normalized.includes('contrast')) return 'stability';
  if (normalized.includes('seo')) return 'seo';
  if (normalized.includes('broken link') || normalized.includes('page links')) return 'broken-links';
  if (normalized.includes('security')) return 'security';
  if (normalized.includes('collect core artifacts') || normalized.includes('artifact: performance') || normalized.includes('artifact: accessibility') || normalized.includes('artifact: core web vitals')) return 'core-artifacts';
  if (normalized.includes('navigate') || normalized.includes('wait for selector')) return 'navigation';
  return 'setup';
};

const toIso = (timeMs: number): string => new Date(timeMs).toISOString();
const toSeconds = (durationMs: number): string => `${(durationMs / 1000).toFixed(2)}s`;
const pad = (value: string, width: number): string => value.padEnd(width, ' ');

const parsePositiveInteger = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const parseBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (!value) {
    return fallback;
  }

  return value.toLowerCase() === 'true';
};

const statusText = (status: TestStatus): string => {
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

export class TestTimingTracker {
  private readonly slowTestThresholdMs: number;

  private readonly logTestSteps: boolean;

  private readonly logSlowestN: number;

  private readonly runId: string;

  private readonly liveLogging: boolean;

  private readonly suiteStartMs: number;

  private readonly tests = new Map<string, TestRecordMutable>();

  public constructor(runId: string) {
    this.runId = runId;
    this.suiteStartMs = Date.now();
    this.slowTestThresholdMs = parsePositiveInteger(process.env.SLOW_TEST_THRESHOLD_MS, DEFAULT_SLOW_TEST_THRESHOLD_MS);
    this.logTestSteps = parseBoolean(process.env.LOG_TEST_STEPS, DEFAULT_LOG_TEST_STEPS);
    this.logSlowestN = parsePositiveInteger(process.env.LOG_SLOWEST_N, DEFAULT_LOG_SLOWEST_N);
    this.liveLogging = parseBoolean(process.env.LIVE_TEST_LOGGING, DEFAULT_LIVE_LOGGING);
  }

  public startTest(file: string, testName: string, retry = 0, options: StartTestOptions = {}): string {
    const reference = `${file}::${testName}#${retry}`;
    const progress = new PageProgressLogger({
      pageLabel: testName,
      pageUrl: options.pageUrl,
      pageIndex: options.pageIndex,
      totalPages: options.totalPages,
      phases: PAGE_PROGRESS_PHASES,
    });

    this.tests.set(reference, {
      reference,
      file,
      testName,
      retry,
      start: Date.now(),
      steps: [],
      progress,
    });

    progress.start();
    progress.startPhase('setup');

    if (this.liveLogging) {
      process.stdout.write(`START   ${testName} (${file})${retry > 0 ? ` retry=${retry}` : ''}${options.pageUrl ? ` | ${options.pageUrl}` : ''}\n`);
    }

    return reference;
  }

  public async step<T>(testReference: string, stepName: string, operation: () => Promise<T>): Promise<T> {
    const stepStart = Date.now();
    try {
      return await operation();
    } finally {
      const stepEnd = Date.now();
      const test = this.tests.get(testReference);
      if (test) {
        const phaseId = phaseFromStepName(stepName);
        if (test.activePhaseId !== phaseId) {
          test.progress.startPhase(phaseId);
          test.activePhaseId = phaseId;
        }

        const stepRecord: TimingStep = {
        name: stepName,
        startTime: toIso(stepStart),
        endTime: toIso(stepEnd),
        durationMs: Math.max(stepEnd - stepStart, 0),
        parentTestReference: testReference,
        };
        test.steps.push(stepRecord);
        test.progress.completePhase(phaseId);
        test.activePhaseId = undefined;

        if (this.liveLogging && !process.stdout.isTTY) {
          process.stdout.write(`  STEP ${pad(toSeconds(stepRecord.durationMs), 8)} ${test.testName}: ${stepRecord.name}\n`);
        }
      }
    }
  }

  public endTest(testReference: string, status: TestStatus): void {
    const test = this.tests.get(testReference);
    if (!test) {
      return;
    }

    test.status = status;
    test.end = Date.now();

    if (status === 'passed') {
      test.progress.complete();
    } else if (status === 'failed' || status === 'timedOut') {
      test.progress.fail(test.activePhaseId ?? null);
    } else {
      test.progress.complete('COMPLETED WITH ERRORS');
    }

    const durationMs = Math.max((test.end ?? test.start) - test.start, 0);
    process.stdout.write(
      `${pad(statusText(status), 7)} ${pad(toSeconds(durationMs), 8)} ${test.testName} (${test.file})${test.retry > 0 ? ` retry=${test.retry}` : ''}\n`,
    );

    if (this.logTestSteps && test.steps.length > 0) {
      for (const step of test.steps) {
        process.stdout.write(`  STEP ${pad(toSeconds(step.durationMs), 8)} ${step.name}\n`);
      }
    }
  }

  public skipPhase(testReference: string, phaseId: string, reason: string): void {
    const test = this.tests.get(testReference);
    if (!test) {
      return;
    }

    test.progress.skipPhase(phaseId, reason);
  }

  public async persist(runRoot: string): Promise<TestTimingArtifact> {
    const artifact = this.buildArtifact();
    const outputPath = path.join(runRoot, TEST_TIMING_FILE_NAME);

    try {
      await mkdir(runRoot, { recursive: true });
      await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      process.stderr.write(`Failed writing test timing artifact at ${outputPath}: ${message}\n`);
    }

    this.printSummary(artifact, outputPath);
    return artifact;
  }

  private buildArtifact(): TestTimingArtifact {
    const suiteEndMs = Date.now();
    const tests = [...this.tests.values()]
      .filter((test): test is TestRecordMutable & Required<Pick<TestRecordMutable, 'status' | 'end'>> => {
        return typeof test.status === 'string' && typeof test.end === 'number';
      })
      .map((test): TimingTest => {
        const durationMs = Math.max(test.end - test.start, 0);
        return {
          reference: test.reference,
          file: test.file,
          testName: test.testName,
          status: test.status,
          retry: test.retry,
          startTime: toIso(test.start),
          endTime: toIso(test.end),
          durationMs,
          isSlow: durationMs >= this.slowTestThresholdMs,
          steps: test.steps,
        };
      });

    const passed = tests.filter((test) => test.status === 'passed').length;
    const failed = tests.filter((test) => test.status === 'failed' || test.status === 'timedOut').length;
    const skipped = tests.filter((test) => test.status === 'skipped').length;

    return {
      runId: this.runId,
      suite: {
        startTime: toIso(this.suiteStartMs),
        endTime: toIso(suiteEndMs),
        durationMs: Math.max(suiteEndMs - this.suiteStartMs, 0),
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

  private printSummary(artifact: TestTimingArtifact, outputPath: string): void {
    const slowest = [...artifact.tests].sort((a, b) => b.durationMs - a.durationMs).slice(0, this.logSlowestN);
    const allTestsByDuration = [...artifact.tests].sort((a, b) => b.durationMs - a.durationMs);

    process.stdout.write('\n=== Test Timing Summary ===\n');
    process.stdout.write(`Run ID: ${artifact.runId}\n`);
    process.stdout.write(`Total duration: ${toSeconds(artifact.suite.durationMs)} (${artifact.suite.durationMs}ms)\n`);
    process.stdout.write(`Total tests: ${artifact.suite.totalTests}\n`);
    process.stdout.write(`Passed/Failed/Skipped: ${artifact.suite.passed}/${artifact.suite.failed}/${artifact.suite.skipped}\n`);
    process.stdout.write(`Slow test threshold: ${artifact.config.slowTestThresholdMs}ms\n`);
    process.stdout.write(`Artifact: ${outputPath}\n`);
    if (slowest.length > 0) {
      process.stdout.write(`Slowest ${slowest.length} tests:\n`);
      for (const test of slowest) {
        const slowSuffix = test.isSlow ? ' SLOW' : '';
        process.stdout.write(`  - ${pad(toSeconds(test.durationMs), 8)} ${test.testName} (${test.file})${slowSuffix}\n`);
      }
    }

    if (allTestsByDuration.length > 0) {
      process.stdout.write('All test durations:\n');
      for (const test of allTestsByDuration) {
        const slowSuffix = test.isSlow ? ' SLOW' : '';
        process.stdout.write(`  - ${pad(toSeconds(test.durationMs), 8)} ${test.testName} (${test.file})${slowSuffix}\n`);

        if (test.steps.length > 0) {
          process.stdout.write('    Steps:\n');
          for (const step of test.steps) {
            process.stdout.write(`      * ${pad(toSeconds(step.durationMs), 8)} ${step.name}\n`);
          }
        }
      }
    }
    process.stdout.write('===========================\n\n');
  }
}
