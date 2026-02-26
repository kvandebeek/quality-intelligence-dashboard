import fs from 'node:fs/promises';
import fssync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  DEBUG: 10,
  INFO: 20,
  WARN: 30,
  ERROR: 40,
  FATAL: 50
};

const SENSITIVE_FIELD_PATTERN = /(token|cookie|password|secret|authorization|api[-_]?key|session)/i;

export interface LogContext {
  runId?: string;
  operationId?: string;
  section?: string;
  view?: string;
  urlId?: string;
  datasetPath?: string;
  filePath?: string;
  durationMs?: number;
  count?: number;
  [key: string]: unknown;
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  appVersion: string;
  buildId: string;
  runId: string;
  operationId?: string;
  context?: Record<string, unknown>;
  error?: { name: string; message: string; stack?: string };
}

export interface LoggerOptions {
  appVersion: string;
  buildId: string;
  runId?: string;
  level?: LogLevel;
  logDir?: string;
  maxFileSizeBytes?: number;
  retentionDays?: number;
}

function normalizeLevel(value: string | undefined): LogLevel {
  const upper = (value ?? '').toUpperCase();
  if (upper in LEVEL_PRIORITY) return upper as LogLevel;
  return 'INFO';
}

function sanitizePath(value: string): string {
  if (!value) return value;
  const home = os.homedir();
  return value.replaceAll(home, '~');
}

function sanitizeObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sanitizeObject(item));
  if (typeof value === 'object' && value !== null) {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_FIELD_PATTERN.test(key)) {
        result[key] = '[REDACTED]';
      } else if (key.toLowerCase().includes('path') && typeof val === 'string') {
        result[key] = sanitizePath(val);
      } else {
        result[key] = sanitizeObject(val);
      }
    }
    return result;
  }
  if (typeof value === 'string' && value.length > 4000) return `${value.slice(0, 4000)}…[truncated]`;
  return value;
}

export function newOperationId(): string {
  return randomUUID();
}

export class AppLogger {
  readonly runId: string;
  readonly appVersion: string;
  readonly buildId: string;
  private level: LogLevel;
  private readonly logDir: string;
  private readonly maxFileSizeBytes: number;
  private readonly retentionDays: number;
  private fileEnabled = true;
  private filePath: string | null = null;
  private currentDay = '';
  private bytesWritten = 0;

  constructor(options: LoggerOptions) {
    this.runId = options.runId ?? randomUUID();
    this.appVersion = options.appVersion;
    this.buildId = options.buildId;
    this.level = options.level ?? normalizeLevel(process.env.LOG_LEVEL);
    this.logDir = options.logDir ? path.resolve(options.logDir) : path.resolve('logs');
    this.maxFileSizeBytes = options.maxFileSizeBytes ?? 5 * 1024 * 1024;
    this.retentionDays = options.retentionDays ?? 14;
  }

  setLevel(level: LogLevel): void {
    this.level = level;
    this.info('Log level updated', { level });
  }

  getLevel(): LogLevel {
    return this.level;
  }

  getLogDirectory(): string {
    return this.logDir;
  }

  getCurrentLogFilePath(): string | null {
    return this.filePath;
  }

  async initialize(): Promise<void> {
    try {
      await fs.mkdir(this.logDir, { recursive: true });
      await this.cleanupOldFiles();
      await this.ensureLogFile();
    } catch (error) {
      this.fileEnabled = false;
      this.writeConsole('WARN', 'Logging fallback to console only', {
        reason: error instanceof Error ? error.message : String(error),
        logDir: this.logDir
      });
    }
  }

  debug(message: string, context?: LogContext): void { this.log('DEBUG', message, context); }
  info(message: string, context?: LogContext): void { this.log('INFO', message, context); }
  warn(message: string, context?: LogContext): void { this.log('WARN', message, context); }
  error(message: string, context?: LogContext, error?: unknown): void { this.log('ERROR', message, context, error); }
  fatal(message: string, context?: LogContext, error?: unknown): void { this.log('FATAL', message, context, error); }

  operation(message: string, context?: LogContext): { operationId: string; end: (status?: string, extra?: LogContext) => void } {
    const operationId = context?.operationId ?? newOperationId();
    const startedAt = Date.now();
    this.info(`${message}:start`, { ...context, operationId });
    return {
      operationId,
      end: (status = 'ok', extra = {}) => {
        const durationMs = Date.now() - startedAt;
        const level: LogLevel = durationMs > 500 ? 'WARN' : 'INFO';
        this.log(level, `${message}:end`, { ...context, ...extra, operationId, status, durationMs });
      }
    };
  }

  private log(level: LogLevel, message: string, context?: LogContext, error?: unknown): void {
    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[this.level]) return;
    const payload = sanitizeObject(context ?? {}) as Record<string, unknown>;
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      appVersion: this.appVersion,
      buildId: this.buildId,
      runId: typeof payload.runId === 'string' ? payload.runId : this.runId,
      operationId: typeof payload.operationId === 'string' ? payload.operationId : undefined,
      context: payload
    };

    if (error !== undefined) {
      const err = error instanceof Error ? error : new Error(String(error));
      entry.error = { name: err.name, message: err.message, stack: err.stack };
      if (!entry.context?.errorMessage) {
        entry.context = { ...entry.context, errorMessage: err.message };
      }
    }

    this.writeConsole(level, message, entry.context, entry.error);
    void this.writeFile(entry);
  }

  private writeConsole(level: LogLevel, message: string, context?: Record<string, unknown>, error?: LogEntry['error']): void {
    const stamp = new Date().toISOString();
    const core = `[${stamp}] [${level}] [run:${this.runId}] ${message}`;
    const ctx = context && Object.keys(context).length > 0 ? ` ${JSON.stringify(context)}` : '';
    process.stdout.write(`${core}${ctx}${error?.stack ? `\n${error.stack}` : ''}\n`);
  }

  private async writeFile(entry: LogEntry): Promise<void> {
    if (!this.fileEnabled) return;
    try {
      await this.ensureLogFile();
      if (!this.filePath) return;
      const line = `${JSON.stringify(entry)}\n`;
      await fs.appendFile(this.filePath, line, 'utf8');
      this.bytesWritten += Buffer.byteLength(line);
    } catch (error) {
      this.fileEnabled = false;
      this.writeConsole('WARN', 'Failed to write to log file; switching to console-only logging', {
        reason: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async ensureLogFile(): Promise<void> {
    if (!this.fileEnabled) return;
    const day = new Date().toISOString().slice(0, 10);
    const needsNew = !this.filePath || this.currentDay !== day || this.bytesWritten >= this.maxFileSizeBytes;
    if (!needsNew) return;

    this.currentDay = day;
    const baseName = `dashboard-${day}`;
    let suffix = 0;
    while (true) {
      const candidate = path.join(this.logDir, suffix === 0 ? `${baseName}.jsonl` : `${baseName}.${suffix}.jsonl`);
      try {
        const stat = await fs.stat(candidate);
        if (stat.size >= this.maxFileSizeBytes || this.currentDay !== day) {
          suffix += 1;
          continue;
        }
        this.filePath = candidate;
        this.bytesWritten = stat.size;
        return;
      } catch {
        await fs.writeFile(candidate, '', { flag: 'a' });
        this.filePath = candidate;
        this.bytesWritten = 0;
        return;
      }
    }
  }

  private async cleanupOldFiles(): Promise<void> {
    const dirEntries = await fs.readdir(this.logDir, { withFileTypes: true });
    const cutoff = Date.now() - this.retentionDays * 24 * 60 * 60 * 1000;
    await Promise.all(dirEntries.filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl')).map(async (entry) => {
      const fullPath = path.join(this.logDir, entry.name);
      try {
        const stat = await fs.stat(fullPath);
        if (stat.mtimeMs < cutoff) await fs.unlink(fullPath);
      } catch {
        // ignore cleanup errors
      }
    }));
  }
}

export function createLogger(): AppLogger {
  const pkgPath = path.resolve('package.json');
  let appVersion = 'unknown';
  if (fssync.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fssync.readFileSync(pkgPath, 'utf8')) as { version?: string };
      appVersion = pkg.version ?? 'unknown';
    } catch {
      appVersion = 'unknown';
    }
  }
  const buildId = process.env.BUILD_ID ?? process.env.GIT_COMMIT ?? 'dev';
  const defaultLevel = normalizeLevel(process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'development' ? 'DEBUG' : 'INFO'));
  return new AppLogger({ appVersion, buildId, level: defaultLevel });
}

export function sanitizeForDiagnostics<T>(value: T): T {
  return sanitizeObject(value) as T;
}
