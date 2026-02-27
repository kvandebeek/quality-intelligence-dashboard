import { emitLog, durationMsFrom, nowNs, type LogContext } from './runtimeLogger.js';

export const step = async <T>(name: string, fn: () => Promise<T>, context: Omit<LogContext, 'durationMs'> = {}): Promise<T> => {
  const startNs = nowNs();
  emitLog('INFO', 'step', `STEP START: ${name}`, context);

  try {
    const result = await fn();
    emitLog('INFO', 'step', `STEP END: ${name}`, { ...context, durationMs: durationMsFrom(startNs) });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emitLog('ERROR', 'step', `STEP FAIL: ${name}`, {
      ...context,
      durationMs: durationMsFrom(startNs),
      metadata: { error: message },
    });
    throw error;
  }
};
