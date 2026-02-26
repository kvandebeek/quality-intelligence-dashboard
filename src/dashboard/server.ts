import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { loadDashboardRun, resolveRunPath } from './data.js';

interface ServerOptions { runPath: string; port: number; staticDir?: string }

async function sendFile(response: http.ServerResponse, filePath: string): Promise<boolean> {
  try {
    const content = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    const contentType = ext === '.css' ? 'text/css; charset=utf-8' : ext === '.js' ? 'text/javascript; charset=utf-8' : ext === '.json' ? 'application/json; charset=utf-8' : ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'text/html; charset=utf-8';
    response.writeHead(200, { 'content-type': contentType });
    response.end(content);
    return true;
  } catch { return false; }
}

export function startDashboardServer(options: ServerOptions): http.Server {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const staticRoot = options.staticDir ?? path.join(here, 'app');

  const server = http.createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? '/', `http://localhost:${options.port}`);
      if (requestUrl.pathname === '/api/model') {
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
      response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      response.end(`Dashboard error: ${error instanceof Error ? error.message : String(error)}`);
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

if (isMainModule(import.meta.url, process.argv[1])) {
  const options = parseServerOptions(process.argv.slice(2));
  startDashboardServer(options);
  process.stdout.write(`Dashboard listening on http://localhost:${options.port} for run ${options.runPath}\n`);
}
