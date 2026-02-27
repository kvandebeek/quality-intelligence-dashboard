import { describe, expect, it, vi } from 'vitest';
import { emitLog, measureOperation } from '../src/playwright/runtimeLogger.js';
import { step } from '../src/playwright/step.js';

describe('runtime logger', () => {
  it('emits structured logs with scope and worker/test markers', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    emitLog('INFO', 'runner', 'Run started', { workerIndex: 1, testId: 'sample' });

    expect(spy).toHaveBeenCalledTimes(1);
    const output = spy.mock.calls[0]?.[0] as string;
    expect(output).toContain('INFO runner [w1] [t:sample] Run started');

    spy.mockRestore();
  });

  it('measureOperation logs start and end with duration', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await measureOperation('action', 'page.goto', async () => Promise.resolve());

    expect(spy).toHaveBeenCalledTimes(2);
    expect((spy.mock.calls[1]?.[0] as string)).toContain('(done in');
    spy.mockRestore();
  });

  it('step rethrows errors and logs failure', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await expect(step('boom', async () => {
      throw new Error('failure');
    })).rejects.toThrow('failure');

    expect(spy.mock.calls.some((call) => String(call[0]).includes('STEP FAIL: boom'))).toBe(true);
    spy.mockRestore();
  });
});
