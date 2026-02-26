import fs from 'node:fs/promises';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildDashboardIndexWithLogger, resolveRunPath, SECTION_FILES, type ArtifactStore, type DashboardIndex } from './data.js';
import { createLogger, newOperationId, sanitizeForDiagnostics, type LogContext, type LogLevel } from './logging.js';

const execFileAsync = promisify(execFile);

interface ServerOptions { runPath: string; port: number; staticDir?: string }

const logger = createLogger();

function readBody(request: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

async function sendFile(response: http.ServerResponse, filePath: string): Promise<boolean> {
  const op = logger.operation('file.send', { filePath });
  try {
    const content = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    const contentType = ext === '.css' ? 'text/css; charset=utf-8' : ext === '.js' ? 'text/javascript; charset=utf-8' : ext === '.json' ? 'application/json; charset=utf-8' : ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'text/html; charset=utf-8';
    response.writeHead(200, { 'content-type': contentType });
    response.end(content);
    op.end('ok', { bytes: content.byteLength });
    return true;
  } catch (error) {
    op.end('missing');
    logger.debug('Static file missing or unreadable', { filePath });
    return false;
  }
}

async function exportDiagnostics(options: ServerOptions, indexState: DashboardIndex | null): Promise<string> {
  const op = logger.operation('diagnostics.export', { datasetPath: options.runPath, view: 'diagnostics' });
  const diagnosticsDir = path.resolve('logs', 'diagnostics');
  await fs.mkdir(diagnosticsDir, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(':', '-');
  const tempDir = path.join(diagnosticsDir, `diag-${stamp}`);
  await fs.mkdir(tempDir, { recursive: true });

  const metadata = sanitizeForDiagnostics({
    exportedAt: new Date().toISOString(),
    appVersion: logger.appVersion,
    buildId: logger.buildId,
    runId: logger.runId,
    nodeVersion: process.version,
    platform: `${os.platform()} ${os.release()}`,
    arch: os.arch(),
    memory: {
      total: os.totalmem(),
      free: os.freemem(),
      processRss: process.memoryUsage().rss
    },
    datasetPath: options.runPath,
    urlCount: indexState?.urls.length ?? 0,
    parseErrors: indexState?.parseErrors ?? []
  });

  const configSnapshot = sanitizeForDiagnostics({
    LOG_LEVEL: process.env.LOG_LEVEL,
    BUILD_ID: process.env.BUILD_ID,
    ARTIFACT_RUN_DIR: process.env.ARTIFACT_RUN_DIR,
    argv: process.argv,
    cwd: process.cwd()
  });

  await fs.writeFile(path.join(tempDir, 'metadata.json'), JSON.stringify(metadata, null, 2), 'utf8');
  await fs.writeFile(path.join(tempDir, 'config.snapshot.json'), JSON.stringify(configSnapshot, null, 2), 'utf8');

  const logsDir = logger.getLogDirectory();
  const logEntries = await fs.readdir(logsDir, { withFileTypes: true }).catch(() => []);
  for (const entry of logEntries) {
    if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
    const source = path.join(logsDir, entry.name);
    const target = path.join(tempDir, 'logs', entry.name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(source, target).catch(() => undefined);
  }

  const zipPath = path.join(diagnosticsDir, `diagnostics-${stamp}.zip`);
  await execFileAsync('zip', ['-r', zipPath, '.'], { cwd: tempDir });
  await fs.rm(tempDir, { recursive: true, force: true });
  op.end('ok', { filePath: zipPath });
  return zipPath;
}

export function startDashboardServer(options: ServerOptions): http.Server {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const staticRoot = options.staticDir ?? path.join(here, 'app');

  let indexState: DashboardIndex | null = null;
  let store: ArtifactStore | null = null;

  const ensureIndex = async (): Promise<void> => {
    if (indexState && store) return;
    const built = await buildDashboardIndexWithLogger(options.runPath, logger);
    indexState = built.index;
    store = built.store;
    logger.info('Index ready', { datasetPath: options.runPath, count: indexState.urls.length, parseErrors: indexState.parseErrors.length });
  };

  const server = http.createServer(async (request, response) => {
    const requestOpId = newOperationId();
    const requestStart = Date.now();
    const requestUrl = new URL(request.url ?? '/', `http://localhost:${options.port}`);
    logger.info('HTTP request started', { operationId: requestOpId, method: request.method, path: requestUrl.pathname });
    try {
      if (requestUrl.pathname === '/api/index') {
        await ensureIndex();
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify(indexState));
        return;
      }

      if (requestUrl.pathname === '/api/log-level' && request.method === 'POST') {
        const body = await readBody(request);
        const parsed = JSON.parse(body) as { level?: LogLevel };
        if (!parsed.level || !['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'].includes(parsed.level)) {
          response.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
          response.end(JSON.stringify({ error: 'Invalid level' }));
          return;
        }
        logger.setLevel(parsed.level);
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ level: logger.getLevel() }));
        return;
      }

      if (requestUrl.pathname === '/api/log' && request.method === 'POST') {
        const body = await readBody(request);
        const parsed = JSON.parse(body) as { level?: LogLevel; message?: string; context?: LogContext };
        const level = parsed.level ?? 'INFO';
        const message = parsed.message ?? 'Client event';
        if (level === 'DEBUG') logger.debug(message, parsed.context);
        else if (level === 'WARN') logger.warn(message, parsed.context);
        else if (level === 'ERROR') logger.error(message, parsed.context);
        else logger.info(message, parsed.context);
        response.writeHead(202, { 'content-type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ accepted: true }));
        return;
      }

      if (requestUrl.pathname === '/api/diagnostics/export' && request.method === 'POST') {
        await ensureIndex();
        const zipPath = await exportDiagnostics(options, indexState);
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ file: zipPath }));
        return;
      }

      if (requestUrl.pathname.startsWith('/api/url/')) {
        await ensureIndex();
        const [, , , rawId, action, rawSection] = requestUrl.pathname.split('/');
        if (!rawId || !store) {
          response.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
          response.end(JSON.stringify({ error: 'Invalid URL id' }));
          return;
        }
        const id = decodeURIComponent(rawId);

        if (action === 'section' && rawSection) {
          const section = decodeURIComponent(rawSection);
          if (!SECTION_FILES.includes(section as never)) {
            response.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
            response.end(JSON.stringify({ error: `Unknown section: ${section}` }));
            return;
          }
          const op = logger.operation('section.load', { operationId: requestOpId, section, urlId: id });
          const data = await store.loadSection(id, section as never);
          response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
          response.end(JSON.stringify({ section, ...data }));
          op.end(data.state, { state: data.state });
          return;
        }
      }

      if (requestUrl.pathname === '/api/model') {
        const { loadDashboardRun } = await import('./data.js');
        const run = await loadDashboardRun(options.runPath);
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify(run));
        return;
      }

      if (requestUrl.pathname.startsWith('/artifacts/')) {
        const rel = requestUrl.pathname.replace('/artifacts/', '');
        const filePath = path.join(options.runPath, rel);
        if (await sendFile(response, filePath)) return;
      }

      const candidate = requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname;
      if (await sendFile(response, path.join(staticRoot, candidate))) return;
      if (await sendFile(response, path.join(here, 'app', candidate))) return;

      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not found');
    } catch (error) {
      logger.error('Request failed', { operationId: requestOpId, path: requestUrl.pathname }, error);
      response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      response.end(`Dashboard error: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      const durationMs = Date.now() - requestStart;
      const level: LogLevel = durationMs > 500 ? 'WARN' : 'INFO';
      logger[level === 'WARN' ? 'warn' : 'info']('HTTP request completed', { operationId: requestOpId, path: requestUrl.pathname, durationMs });
    }
  });
  server.listen(options.port);
  return server;
}

export function parseServerOptions(argv: readonly string[]): ServerOptions {
  const parsed = parseArgs({ args: argv, options: { run: { type: 'string' }, port: { type: 'string', default: '4173' }, static: { type: 'boolean', default: false } } });
  const runPath = resolveRunPath({ cliRunPath: parsed.values.run, envRunPath: process.env.ARTIFACT_RUN_DIR });
  const port = Number(parsed.values.port);
  if (!Number.isFinite(port) || port <= 0) throw new Error(`Invalid port: ${parsed.values.port}`);
  return { runPath, port, staticDir: parsed.values.static ? path.resolve('dist/dashboard') : undefined };
}

export function isMainModule(metaUrl: string, argvPath: string | undefined): boolean {
  if (!argvPath) return false;
  return path.resolve(fileURLToPath(metaUrl)) === path.resolve(argvPath);
}

async function main(): Promise<void> {
  await logger.initialize();
  logger.info('Application start', { datasetPath: process.env.ARTIFACT_RUN_DIR, pid: process.pid });

  process.on('uncaughtException', (error) => {
    logger.fatal('Uncaught exception', { view: 'server' }, error);
  });
  process.on('unhandledRejection', (reason) => {
    logger.fatal('Unhandled promise rejection', { view: 'server' }, reason);
  });

  const options = parseServerOptions(process.argv.slice(2));
  const server = startDashboardServer(options);
  logger.info('Application ready', { datasetPath: options.runPath, port: options.port });
  process.stdout.write(`Dashboard listening on http://localhost:${options.port} for run ${options.runPath}\n`);

  const shutdown = (signal: NodeJS.Signals) => {
    logger.info('Application shutdown requested', { signal });
    server.close(() => {
      logger.info('Application shutdown complete', { signal });
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (isMainModule(import.meta.url, process.argv[1])) {
  main().catch((error) => {
    logger.fatal('Startup failure', { view: 'startup' }, error);
    process.exitCode = 1;
  });
}
