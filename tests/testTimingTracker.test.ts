import { mkdtempSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { TestTimingTracker } from '../src/core/testTiming.js';

describe('TestTimingTracker', () => {
  it('writes test timing json and tracks steps', async () => {
    const runId = `run-${Date.now()}`;
    const tracker = new TestTimingTracker(runId);
    const testReference = tracker.startTest('tests/sample.spec.ts', 'sample test', 0);

    await tracker.step(testReference, 'first step', async () => {
      await Promise.resolve();
    });

    tracker.endTest(testReference, 'passed');

    const outputRoot = mkdtempSync(path.join(tmpdir(), 'timing-'));
    const runRoot = path.join(outputRoot, runId);
    const artifact = await tracker.persist(runRoot);

    expect(artifact.runId).toBe(runId);
    expect(artifact.suite.totalTests).toBe(1);
    expect(artifact.tests[0]?.steps.length).toBe(1);

    const parsed = JSON.parse(readFileSync(path.join(runRoot, 'test-timing.json'), 'utf8')) as {
      runId: string;
      suite: { totalTests: number };
      tests: Array<{ steps: unknown[] }>;
    };

    expect(parsed.runId).toBe(runId);
    expect(parsed.suite.totalTests).toBe(1);
    expect(parsed.tests[0]?.steps.length).toBe(1);

    await rm(outputRoot, { recursive: true, force: true });
  });
});
