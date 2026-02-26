import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

function renderBrandLogo(): string {
  return `<svg viewBox="0 0 598 200" role="img" aria-label="Resillion" xmlns="http://www.w3.org/2000/svg">
  <rect x="228" y="0" width="20" height="20" rx="4" fill="#ff3b24"></rect>
  <rect x="380" y="0" width="20" height="106" rx="3" fill="#8bc53f"></rect>
  <rect x="380" y="116" width="20" height="20" rx="3" fill="#8bc53f"></rect>
  <text x="36" y="132" fill="#ffffff" font-family="Inter,Segoe UI,sans-serif" font-size="84" font-weight="700">Resillion</text>
  <text x="30" y="185" fill="#8bc53f" font-family="Inter,Segoe UI,sans-serif" font-size="44" font-weight="700">Assure. Secure. Innovate.</text>
</svg>`;
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
<header class="site-header">
  <div class="container header-layout">
    <a href="/" class="brand-logo d-flex align-items-center" aria-label="Resillion home">${renderBrandLogo()}</a>
    <nav class="desktop-only" aria-label="Primary">
      <ul class="main-menu">
        <li class="menu-item"><a href="/">Overview</a></li>
        <li class="menu-item"><a href="/summary">Run Summary</a></li>
        <li class="menu-item has-sub-menu" data-expanded="false">
          <button type="button" class="menu-trigger" aria-expanded="false" aria-controls="desktop-sub-menu">Sections</button>
          <ul id="desktop-sub-menu" class="sub-menu" aria-label="Sections submenu">
            <li><a href="/">URLs</a></li>
            <li><a href="/summary">Metrics</a></li>
          </ul>
        </li>
      </ul>
    </nav>
    <div class="buttons-block desktop-only">
      <a class="btn btn-fade" href="/summary">Summary</a>
      <a class="btn btn-slide" href="/">Open Dashboard</a>
    </div>
    <button type="button" class="mobile-nav-toggle" aria-label="Toggle navigation" aria-expanded="false" aria-controls="mobile-nav">Menu</button>
  </div>
  <nav id="mobile-nav" class="mobile-nav" data-open="false" aria-label="Mobile">
    <ul>
      <li class="menu-item"><a href="/">Overview</a></li>
      <li class="menu-item"><a href="/summary">Run Summary</a></li>
      <li class="menu-item"><a href="#left-nav">Filters</a></li>
    </ul>
  </nav>
</header>
<main>${body}</main>
<script>
(function(){
  const menuToggle = document.querySelector('.mobile-nav-toggle');
  const mobileNav = document.getElementById('mobile-nav');
  if (menuToggle && mobileNav) {
    const leftNav = document.getElementById('left-nav');
    const toggleMobile = function(){
      const open = mobileNav.getAttribute('data-open') === 'true';
      mobileNav.setAttribute('data-open', String(!open));
      menuToggle.setAttribute('aria-expanded', String(!open));
      if (leftNav) {
        leftNav.setAttribute('data-open', String(!open));
      }
    };
    menuToggle.addEventListener('click', toggleMobile);
    menuToggle.addEventListener('keydown', function(event){
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggleMobile();
      }
    });
  }

  const trigger = document.querySelector('.menu-trigger');
  const host = document.querySelector('.has-sub-menu');
  if (trigger && host) {
    const toggleSubmenu = function(){
      const expanded = host.getAttribute('data-expanded') === 'true';
      host.setAttribute('data-expanded', String(!expanded));
      trigger.setAttribute('aria-expanded', String(!expanded));
    };
    trigger.addEventListener('click', toggleSubmenu);
    trigger.addEventListener('keydown', function(event){
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggleSubmenu();
      }
    });
  }

  const detailToggle = document.querySelector('[data-detail-toggle]');
  const detailPanel = document.querySelector('.right-panel');
  if (detailToggle && detailPanel) {
    const toggleDetail = function(){
      const open = detailPanel.getAttribute('data-open') === 'true';
      detailPanel.setAttribute('data-open', String(!open));
      detailToggle.setAttribute('aria-expanded', String(!open));
    };
    detailToggle.addEventListener('click', toggleDetail);
    detailToggle.addEventListener('keydown', function(event){
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggleDetail();
      }
    });
  }
})();
</script>
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
  const selectedUrlId = requestUrl.searchParams.get('selectedUrlId');
  const selectedRow = sortedRows.find((row) => row.folderName === selectedUrlId) ?? sortedRows[0];

  const cardMarkup = sortedRows
    .map((row) => {
      const cardUrl = new URL(requestUrl.pathname || '/', 'http://localhost');
      requestUrl.searchParams.forEach((value, key) => {
        if (key !== 'selectedUrlId') {
          cardUrl.searchParams.set(key, value);
        }
      });
      cardUrl.searchParams.set('selectedUrlId', row.folderName);
      const selectedClass = selectedRow?.folderName === row.folderName ? ' is-selected' : '';
      return `<article class="card${selectedClass}">
  <header class="card-header">${escapeHtml(row.url)}</header>
  <div class="card-body">
    <div class="metric-line"><span>A11y C/S</span><strong>${row.critical}/${row.serious}</strong></div>
    <div class="metric-line"><span>Load Event</span><strong>${row.loadEventMs} ms</strong></div>
    <div class="metric-line"><span>Requests</span><strong>${row.requestCount}</strong></div>
  </div>
  <footer class="card-footer"><a class="btn btn-fade w-100 text-center" href="${escapeHtml(`${cardUrl.pathname}${cardUrl.search}`)}">View details</a></footer>
</article>`;
    })
    .join('');

  return renderLayout(
    'Artifacts Dashboard Overview',
    `<section class="page-block gradient-bg">
  <div class="container">
    <div class="row">
      <div class="col-12">
        <div class="dashboard-grid align-items-stretch">
      <aside id="left-nav" class="left-nav panel" data-open="false" aria-label="Dashboard filters">
        <div class="panel-header">LeftNav</div>
        <div class="panel-body filter-stack">
          <form method="get">
            <label for="search">Search URL
              <input id="search" type="text" name="search" value="${escapeHtml(requestUrl.searchParams.get('search') ?? '')}" />
            </label>
            <label><input type="checkbox" name="hasCriticalOrSerious" value="1" ${requestUrl.searchParams.get('hasCriticalOrSerious') === '1' ? 'checked' : ''}/> Has critical/serious</label>
            <label><input type="checkbox" name="hasFailures" value="1" ${requestUrl.searchParams.get('hasFailures') === '1' ? 'checked' : ''}/> Has network failures</label>
            <label>loadEventMs above
              <input type="number" name="loadEventMin" value="${escapeHtml(requestUrl.searchParams.get('loadEventMin') ?? '')}" />
            </label>
            <label>Sort by
              <select name="sortBy">${Object.keys(SORTABLE_COLUMNS)
                .map((key) => `<option value="${key}" ${sortBy === key ? 'selected' : ''}>${key}</option>`)
                .join('')}</select>
            </label>
            <label>Direction
              <select name="direction"><option value="asc" ${direction === 'asc' ? 'selected' : ''}>asc</option><option value="desc" ${direction === 'desc' ? 'selected' : ''}>desc</option></select>
            </label>
            ${selectedRow ? `<input type="hidden" name="selectedUrlId" value="${escapeHtml(selectedRow.folderName)}" />` : ''}
            <button class="btn btn-slide w-100" type="submit">Apply</button>
          </form>
          <button type="button" class="btn btn-fade w-100" data-detail-toggle aria-expanded="false">Toggle detail panel</button>
        </div>
      </aside>

      <section class="main-content" aria-label="Main content">
        <div class="panel purple-light-bg">
          <div class="panel-header">MainContent — URL Overview</div>
          <div class="panel-body">
            <p class="muted text-center mx-auto">Total visible rows: ${sortedRows.length}</p>
            <div class="url-grid">${cardMarkup || '<p>No URLs available for selected filters.</p>'}</div>
          </div>
        </div>
      </section>

      <aside class="right-panel" data-open="false" aria-label="Selected URL detail">
        <div class="panel sticky-panel second-half-gradient">
          <div class="panel-header">RightDetailPanel</div>
          <div class="panel-body">
            ${
              selectedRow
                ? `<p><strong>${escapeHtml(selectedRow.url)}</strong></p>
                   <p class="muted">Folder: ${escapeHtml(selectedRow.folderName)}</p>
                   <div class="metric-line"><span>TTFB</span><strong>${selectedRow.ttfbMs} ms</strong></div>
                   <div class="metric-line"><span>DCL</span><strong>${selectedRow.dclMs} ms</strong></div>
                   <div class="metric-line"><span>Load</span><strong>${selectedRow.loadEventMs} ms</strong></div>
                   <div class="metric-line"><span>Failed reqs</span><strong>${selectedRow.failedRequestCount}</strong></div>
                   <p><a class="btn btn-slide w-100" href="/page/${encodeURIComponent(selectedRow.folderName)}">Open full details</a></p>`
                : '<p class="muted">Select a URL card to view detail placeholder.</p>'
            }
          </div>
        </div>
      </aside>
        </div>
      </div>
    </div>
  </div>
</section>`
  );
}

function renderDrilldown(folderName: string, requestUrl: URL, rows: readonly OverviewRow[]): string {
  const row = rows.find((entry) => entry.folderName === folderName);
  if (!row) {
    return renderLayout('Not found', `<section class="page-block"><div class="container"><h1>Page not found</h1><p>No folder named ${escapeHtml(folderName)}.</p></div></section>`);
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
    `<section class="page-block white-bg"><div class="container"><h1>${escapeHtml(row.url)}</h1>
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
<form method="get" class="filters">
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
<ul>${recommendationList}</ul></div></section>`
  );
}

function renderRunSummary(rows: readonly OverviewRow[]): string {
  const summary = computeRunSummary(rows);
  const worstList = (items: readonly OverviewRow[], metricLabel: string, metric: (row: OverviewRow) => number): string =>
    `<ol>${items.map((row) => `<li>${escapeHtml(row.url)} — ${metricLabel}: ${metric(row)}</li>`).join('')}</ol>`;

  return renderLayout(
    'Run Summary',
    `<section class="page-block purple-bg"><div class="container"><h1>Run Summary</h1>
<ul>
<li>Total pages: ${summary.totalPages}</li>
<li>Accessibility totals: critical ${summary.accessibilityTotals.critical}, serious ${summary.accessibilityTotals.serious}, moderate ${summary.accessibilityTotals.moderate}, minor ${summary.accessibilityTotals.minor}</li>
</ul>
<h2>Worst pages by loadEventMs</h2>
${worstList(summary.worstByLoadEventMs, 'loadEventMs', (row) => row.loadEventMs)}
<h2>Worst pages by critical accessibility issues</h2>
${worstList(summary.worstByCriticalIssues, 'critical', (row) => row.critical)}
<h2>Worst pages by total transfer size</h2>
${worstList(summary.worstByTransferSize, 'totalTransferSize', (row) => row.totalTransferSize)}</div></section>`
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

      if (options.staticDir && (requestUrl.pathname.endsWith('.css') || requestUrl.pathname === '/index.html' || requestUrl.pathname.startsWith('/styles/'))) {
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

      if (requestUrl.pathname.startsWith('/styles/')) {
        const stylePath = path.join(path.dirname(new URL(import.meta.url).pathname), `.${requestUrl.pathname}`);
        const css = await fs.readFile(stylePath, 'utf8');
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

export function isMainModule(metaUrl: string, argvPath: string | undefined): boolean {
  if (!argvPath) {
    return false;
  }

  return path.resolve(fileURLToPath(metaUrl)) === path.resolve(argvPath);
}

if (isMainModule(import.meta.url, process.argv[1])) {
  const options = parseServerOptions(process.argv.slice(2));
  startDashboardServer(options);
  process.stdout.write(`Dashboard listening on http://localhost:${options.port} for run ${options.runPath}\n`);
}
