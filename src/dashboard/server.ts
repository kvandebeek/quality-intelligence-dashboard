import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { computeRunSummary, loadDashboardRun, resolveRunPath, toOverviewRows, type OverviewRow } from './data.js';

interface ServerOptions {
  runPath: string;
  port: number;
  staticDir?: string;
}

type SortDirection = 'asc' | 'desc';

const SORTABLE_COLUMNS: Record<string, (row: OverviewRow) => number | string> = {
  url: (row) => row.url,
  critical: (row) => row.critical,
  serious: (row) => row.serious,
  moderate: (row) => row.moderate,
  minor: (row) => row.minor,
  ttfbMs: (row) => row.ttfbMs,
  dclMs: (row) => row.dclMs,
  loadEventMs: (row) => row.loadEventMs,
  totalTransferSize: (row) => row.totalTransferSize,
  resourceCount: (row) => row.resourceCount,
  requestCount: (row) => row.requestCount,
  failedRequestCount: (row) => row.failedRequestCount,
  networkTransferSize: (row) => row.networkTransferSize,
  slowestRequestMs: (row) => row.slowestRequestMs
};

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderLayout(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="/styles.css" />
</head>
<body>
<nav>
  <a href="/">Overview</a>
  <a href="/summary">Run Summary</a>
</nav>
<main>${body}</main>
</body>
</html>`;
}

function numberParam(value: string | null): number | undefined {
  if (value === null || value.trim() === '') {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function sortRows(rows: readonly OverviewRow[], sortBy: string, direction: SortDirection): OverviewRow[] {
  const accessor = SORTABLE_COLUMNS[sortBy] ?? SORTABLE_COLUMNS.url;
  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const leftValue = accessor(left.row);
      const rightValue = accessor(right.row);
      const baseCompare =
        typeof leftValue === 'string' && typeof rightValue === 'string'
          ? leftValue.localeCompare(rightValue)
          : Number(leftValue) - Number(rightValue);
      if (baseCompare !== 0) {
        return direction === 'asc' ? baseCompare : -baseCompare;
      }
      const urlCompare = left.row.url.localeCompare(right.row.url);
      if (urlCompare !== 0) {
        return urlCompare;
      }
      return left.index - right.index;
    })
    .map((entry) => entry.row);
}

function filterRows(rows: readonly OverviewRow[], requestUrl: URL): OverviewRow[] {
  const search = (requestUrl.searchParams.get('search') ?? '').trim().toLowerCase();
  const hasCriticalOrSerious = requestUrl.searchParams.get('hasCriticalOrSerious') === '1';
  const hasFailures = requestUrl.searchParams.get('hasFailures') === '1';
  const loadEventMin = numberParam(requestUrl.searchParams.get('loadEventMin'));

  return rows.filter((row) => {
    if (search.length > 0 && !row.url.toLowerCase().includes(search)) {
      return false;
    }
    if (hasCriticalOrSerious && row.critical + row.serious === 0) {
      return false;
    }
    if (hasFailures && row.failedRequestCount === 0) {
      return false;
    }
    if (loadEventMin !== undefined && row.loadEventMs <= loadEventMin) {
      return false;
    }
    return true;
  });
}

function renderOverview(requestUrl: URL, rows: readonly OverviewRow[]): string {
  const sortBy = requestUrl.searchParams.get('sortBy') ?? 'url';
  const direction: SortDirection = requestUrl.searchParams.get('direction') === 'desc' ? 'desc' : 'asc';
  const filteredRows = filterRows(rows, requestUrl);
  const sortedRows = sortRows(filteredRows, sortBy, direction);

  const recColumn = (counts: Record<string, number>): string =>
    Object.entries(counts)
      .map(([severity, count]) => `${escapeHtml(severity)}:${count}`)
      .join(', ');

  const tableRows = sortedRows
    .map(
      (row) => `<tr>
<td><a href="/page/${encodeURIComponent(row.folderName)}">${escapeHtml(row.url)}</a></td>
<td>${row.critical}/${row.serious}/${row.moderate}/${row.minor}</td>
<td>${row.ttfbMs}</td><td>${row.dclMs}</td><td>${row.loadEventMs}</td>
<td>${row.totalTransferSize}</td><td>${row.resourceCount}</td>
<td>${row.requestCount}</td><td>${row.failedRequestCount}</td><td>${row.networkTransferSize}</td><td>${row.slowestRequestMs}</td>
<td>${escapeHtml(recColumn(row.recommendationCounts) || '-')}</td>
</tr>`
    )
    .join('');

  return renderLayout(
    'Artifacts Dashboard Overview',
    `<h1>Artifacts Overview</h1>
<form method="get" class="filters">
<label>URL search <input type="text" name="search" value="${escapeHtml(requestUrl.searchParams.get('search') ?? '')}" /></label>
<label><input type="checkbox" name="hasCriticalOrSerious" value="1" ${requestUrl.searchParams.get('hasCriticalOrSerious') === '1' ? 'checked' : ''}/> Has critical/serious</label>
<label><input type="checkbox" name="hasFailures" value="1" ${requestUrl.searchParams.get('hasFailures') === '1' ? 'checked' : ''}/> Has network failures</label>
<label>loadEventMs &gt; <input type="number" name="loadEventMin" value="${escapeHtml(requestUrl.searchParams.get('loadEventMin') ?? '')}" /></label>
<label>Sort by
<select name="sortBy">${Object.keys(SORTABLE_COLUMNS)
      .map((key) => `<option value="${key}" ${sortBy === key ? 'selected' : ''}>${key}</option>`)
      .join('')}</select>
</label>
<label>Direction
<select name="direction"><option value="asc" ${direction === 'asc' ? 'selected' : ''}>asc</option><option value="desc" ${direction === 'desc' ? 'selected' : ''}>desc</option></select>
</label>
<button type="submit">Apply</button>
</form>
<table>
<thead><tr><th>URL</th><th>A11y C/S/M/Mn</th><th>TTFB</th><th>DCL</th><th>Load</th><th>Perf Transfer</th><th>Resources</th><th>Requests</th><th>Failed</th><th>Net Transfer</th><th>Slowest Req</th><th>Recommendations</th></tr></thead>
<tbody>${tableRows}</tbody>
</table>
<p>Total visible rows: ${sortedRows.length}</p>`
  );
}

function renderDrilldown(folderName: string, requestUrl: URL, rows: readonly OverviewRow[]): string {
  const row = rows.find((entry) => entry.folderName === folderName);
  if (!row) {
    return renderLayout('Not found', `<h1>Page not found</h1><p>No folder named ${escapeHtml(folderName)}.</p>`);
  }

  const statusFilter = requestUrl.searchParams.get('statusClass') ?? 'all';
  const requestSort = requestUrl.searchParams.get('requestSort') ?? 'durationMs';

  const filteredRequests = row.networkRequests.filter((request) => {
    if (statusFilter === '4xx') {
      return request.status >= 400 && request.status < 500;
    }
    if (statusFilter === '5xx') {
      return request.status >= 500 && request.status < 600;
    }
    return true;
  });

  const sortedRequests = filteredRequests
    .map((request, index) => ({ request, index }))
    .sort((left, right) => {
      const delta = requestSort === 'transferSize' ? right.request.transferSize - left.request.transferSize : right.request.durationMs - left.request.durationMs;
      if (delta !== 0) {
        return delta;
      }
      const urlCompare = left.request.url.localeCompare(right.request.url);
      if (urlCompare !== 0) {
        return urlCompare;
      }
      return left.index - right.index;
    })
    .map((entry) => entry.request);

  const groupedRecommendations = row.networkRecommendations.reduce<Record<string, string[]>>((accumulator, recommendation) => {
    const key = recommendation.severity;
    if (!accumulator[key]) {
      accumulator[key] = [];
    }
    accumulator[key].push(`${recommendation.title} (${recommendation.impactedCount})`);
    return accumulator;
  }, {});

  const recommendationList = Object.entries(groupedRecommendations)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([severity, entries]) => `<li><strong>${escapeHtml(severity)}</strong>: ${escapeHtml(entries.join(', '))}</li>`)
    .join('');

  return renderLayout(
    `Drilldown ${row.url}`,
    `<h1>${escapeHtml(row.url)}</h1>
<p>Folder: ${escapeHtml(row.folderName)}</p>
<p><a href="${escapeHtml(row.url)}" target="_blank" rel="noreferrer">Open URL</a></p>
<h2>Accessibility Issues</h2>
<table><thead><tr><th>id</th><th>impact</th><th>nodes</th><th>description</th><th>recommendation</th></tr></thead><tbody>
${row.accessibilityIssues
      .map(
        (issue) => `<tr><td>${escapeHtml(issue.id)}</td><td>${escapeHtml(issue.impact)}</td><td>${issue.nodes}</td><td>${escapeHtml(issue.description)}</td><td>${escapeHtml(issue.recommendation)}</td></tr>`
      )
      .join('')}
</tbody></table>
<h2>Performance</h2>
<ul>
<li>TTFB (responseStart): ${row.ttfbMs}</li>
<li>DCL (domContentLoadedEventEnd): ${row.dclMs}</li>
<li>Load (loadEventEnd): ${row.loadEventMs}</li>
<li>Resource count: ${row.resourceCount}</li>
<li>Resource transfer size: ${row.totalTransferSize}</li>
</ul>
<h2>Network Requests</h2>
<form method="get">
<label>Status class
<select name="statusClass">
<option value="all" ${statusFilter === 'all' ? 'selected' : ''}>all</option>
<option value="4xx" ${statusFilter === '4xx' ? 'selected' : ''}>4xx</option>
<option value="5xx" ${statusFilter === '5xx' ? 'selected' : ''}>5xx</option>
</select>
</label>
<label>Sort
<select name="requestSort">
<option value="durationMs" ${requestSort === 'durationMs' ? 'selected' : ''}>durationMs</option>
<option value="transferSize" ${requestSort === 'transferSize' ? 'selected' : ''}>transferSize</option>
</select>
</label>
<button type="submit">Apply</button>
</form>
<table><thead><tr><th>status</th><th>method</th><th>url</th><th>transferSize</th><th>durationMs</th><th>fromCache</th></tr></thead><tbody>
${sortedRequests
      .map(
        (request) => `<tr><td>${request.status}</td><td>${escapeHtml(request.method)}</td><td>${escapeHtml(request.url)}</td><td>${request.transferSize}</td><td>${request.durationMs}</td><td>${request.fromCache}</td></tr>`
      )
      .join('')}
</tbody></table>
<h2>Recommendations by Severity</h2>
<ul>${recommendationList}</ul>`
  );
}

function renderRunSummary(rows: readonly OverviewRow[]): string {
  const summary = computeRunSummary(rows);
  const worstList = (items: readonly OverviewRow[], metricLabel: string, metric: (row: OverviewRow) => number): string =>
    `<ol>${items.map((row) => `<li>${escapeHtml(row.url)} — ${metricLabel}: ${metric(row)}</li>`).join('')}</ol>`;

  return renderLayout(
    'Run Summary',
    `<h1>Run Summary</h1>
<ul>
<li>Total pages: ${summary.totalPages}</li>
<li>Accessibility totals: critical ${summary.accessibilityTotals.critical}, serious ${summary.accessibilityTotals.serious}, moderate ${summary.accessibilityTotals.moderate}, minor ${summary.accessibilityTotals.minor}</li>
</ul>
<h2>Worst pages by loadEventMs</h2>
${worstList(summary.worstByLoadEventMs, 'loadEventMs', (row) => row.loadEventMs)}
<h2>Worst pages by critical accessibility issues</h2>
${worstList(summary.worstByCriticalIssues, 'critical', (row) => row.critical)}
<h2>Worst pages by total transfer size</h2>
${worstList(summary.worstByTransferSize, 'totalTransferSize', (row) => row.totalTransferSize)}`
  );
}

async function sendStaticFile(response: http.ServerResponse, staticDir: string, requestPath: string): Promise<boolean> {
  const normalizedPath = requestPath === '/' ? '/index.html' : requestPath;
  const filePath = path.join(staticDir, normalizedPath);
  try {
    const content = await fs.readFile(filePath);
    const contentType = filePath.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8';
    response.writeHead(200, { 'content-type': contentType });
    response.end(content);
    return true;
  } catch {
    return false;
  }
}

export function startDashboardServer(options: ServerOptions): http.Server {
  const server = http.createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? '/', `http://localhost:${options.port}`);

      if (options.staticDir && (requestUrl.pathname.endsWith('.css') || requestUrl.pathname === '/index.html')) {
        if (await sendStaticFile(response, options.staticDir, requestUrl.pathname)) {
          return;
        }
      }

      if (requestUrl.pathname === '/styles.css') {
        const css = await fs.readFile(path.join(path.dirname(new URL(import.meta.url).pathname), 'styles.css'), 'utf8');
        response.writeHead(200, { 'content-type': 'text/css; charset=utf-8' });
        response.end(css);
        return;
      }

      const runData = await loadDashboardRun(options.runPath);
      const rows = toOverviewRows(runData);

      if (requestUrl.pathname === '/') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(renderOverview(requestUrl, rows));
        return;
      }

      if (requestUrl.pathname.startsWith('/page/')) {
        const folderName = decodeURIComponent(requestUrl.pathname.slice('/page/'.length));
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(renderDrilldown(folderName, requestUrl, rows));
        return;
      }

      if (requestUrl.pathname === '/summary') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(renderRunSummary(rows));
        return;
      }

      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not found');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      response.end(`Dashboard error: ${message}`);
    }
  });

  server.listen(options.port);
  return server;
}

export function parseServerOptions(argv: readonly string[]): ServerOptions {
  const parsed = parseArgs({
    args: argv,
    options: {
      run: { type: 'string' },
      port: { type: 'string', default: '4173' },
      static: { type: 'boolean', default: false }
    }
  });

  const runPath = resolveRunPath({ cliRunPath: parsed.values.run, envRunPath: process.env.ARTIFACT_RUN_DIR });
  const port = Number(parsed.values.port);
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`Invalid port: ${parsed.values.port}`);
  }
  const staticDir = parsed.values.static ? path.resolve('dist/dashboard') : undefined;
  return { runPath, port, staticDir };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const options = parseServerOptions(process.argv.slice(2));
  startDashboardServer(options);
  process.stdout.write(`Dashboard listening on http://localhost:${options.port} for run ${options.runPath}\n`);
}
