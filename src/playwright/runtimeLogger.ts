import process from 'node:process';

export type LogLevel = 'INFO' | 'DEBUG' | 'WARN' | 'ERROR';
export type LogScope = 'runner' | 'worker' | 'test' | 'hook' | 'step' | 'action' | 'network';
export type LogVerbosity = 'info' | 'debug' | 'trace';

export type LogContext = {
  readonly workerIndex?: number;
  readonly testId?: string;
  readonly durationMs?: number;
  readonly metadata?: Record<string, unknown>;
};

const NS_PER_MS = 1_000_000n;

const parseVerbosity = (value: string | undefined): LogVerbosity => {
  if (value === 'debug' || value === 'trace') {
    return value;
  }

  return 'info';
};

const runStartNs = (() => {
  const envValue = process.env.PW_RUN_START_NS;
  if (!envValue) {
    return process.hrtime.bigint();
  }

  try {
    const parsed = BigInt(envValue);
    return parsed > 0n ? parsed : process.hrtime.bigint();
  } catch {
    return process.hrtime.bigint();
  }
})();

const verbosity = parseVerbosity(process.env.LOG_LEVEL);

const shouldEmit = (level: LogLevel): boolean => {
  if (level === 'ERROR' || level === 'WARN' || level === 'INFO') {
    return true;
  }

  return verbosity === 'debug' || verbosity === 'trace';
};

const pad = (value: number): string => `${value}`.padStart(2, '0');

const formatIsoWithOffset = (date: Date): string => {
  const tzMinutes = -date.getTimezoneOffset();
  const sign = tzMinutes >= 0 ? '+' : '-';
  const absMinutes = Math.abs(tzMinutes);
  const hours = Math.floor(absMinutes / 60);
  const minutes = absMinutes % 60;

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${`${date.getMilliseconds()}`.padStart(3, '0')}${sign}${pad(hours)}:${pad(minutes)}`;
};

const relativeSeconds = (timeNs: bigint): string => {
  const elapsedNs = timeNs - runStartNs;
  const elapsedMs = Number(elapsedNs) / Number(NS_PER_MS);
  return `+${(elapsedMs / 1000).toFixed(3)}s`;
};

const fmtDuration = (durationMs: number | undefined): string => {
  if (typeof durationMs !== 'number') {
    return '';
  }

  return ` (done in ${durationMs.toFixed(3)}ms)`;
};

export const isTraceEnabled = (): boolean => verbosity === 'trace';

export const nowNs = (): bigint => process.hrtime.bigint();

export const durationMsFrom = (startNs: bigint, endNs = nowNs()): number => Number(endNs - startNs) / Number(NS_PER_MS);

export const formatTestId = (file: string, title: string, retry: number): string => `${file} :: ${title} [retry:${retry}]`;

export const emitLog = (level: LogLevel, scope: LogScope, message: string, context: LogContext = {}): void => {
  if (!shouldEmit(level)) {
    return;
  }

  const currentNs = nowNs();
  const timestamp = formatIsoWithOffset(new Date());
  const relative = relativeSeconds(currentNs);
  const workerToken = `[w${context.workerIndex ?? '-'}]`;
  const testToken = `[t:${context.testId ?? '-'}]`;
  const metadataSuffix = context.metadata ? ` ${JSON.stringify(context.metadata)}` : '';
  const durationSuffix = fmtDuration(context.durationMs);

  console.log(`${timestamp} ${relative} ${level} ${scope} ${workerToken} ${testToken} ${message}${durationSuffix}${metadataSuffix}`);
};

export const measureOperation = async <T>(
  scope: LogScope,
  operationName: string,
  execute: () => Promise<T>,
  context: Omit<LogContext, 'durationMs'> = {},
): Promise<T> => {
  const startNs = nowNs();
  emitLog('INFO', scope, `${operationName} START`, context);

  try {
    const result = await execute();
    emitLog('INFO', scope, `${operationName} END`, { ...context, durationMs: durationMsFrom(startNs) });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emitLog('ERROR', scope, `${operationName} FAIL`, {
      ...context,
      durationMs: durationMsFrom(startNs),
      metadata: { error: message },
    });
    throw error;
  }
};

export const getRunStartNs = (): bigint => runStartNs;
