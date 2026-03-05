const MISSING = 'unknown';

const toNum = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const escapeHtml = (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');

function asText(value){
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function asUrl(value){
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function formatCount(value){
  const numeric = toNum(value);
  if (numeric === null) return '0';
  return String(Number.isInteger(numeric) ? numeric : Number(numeric.toFixed(2)));
}

function metric(label, value){
  return `<div class="kpi"><span>${label}</span><strong>${formatCount(value)}</strong></div>`;
}

function formatUnknown(value){
  const text = asText(value);
  return text ?? MISSING;
}

function readErrors(record){
  const found = [];
  for (const key of ['failureReason', 'reason', 'error']) {
    const value = asText(record?.[key]);
    if (value) found.push(value);
  }
  if (Array.isArray(record?.errors)) {
    for (const item of record.errors) {
      const value = asText(item);
      if (value) found.push(value);
    }
  }
  return [...new Set(found)].sort((a, b) => a.localeCompare(b));
}

export function normalizeBrokenLinkRow(raw){
  if (!raw || typeof raw !== 'object') return null;
  const sourcePageUrl = asUrl(raw.sourcePageUrl ?? raw.sourceUrl ?? raw.pageUrl ?? raw.page ?? raw.referrerUrl ?? raw.parentUrl);
  const brokenUrl = asUrl(raw.brokenUrl ?? raw.url ?? raw.linkUrl ?? raw.href ?? raw.targetUrl ?? raw.destinationUrl);
  if (!brokenUrl) return null;

  const status = toNum(raw.statusCode ?? raw.status ?? raw.httpStatus ?? raw.code);
  const linkText = asText(raw.linkText ?? raw.anchorText ?? raw.text ?? raw.label);
  const selector = asText(raw.selector ?? raw.cssSelector ?? raw.xpath);
  const errors = readErrors(raw);

  return {
    sourcePageUrl,
    brokenUrl,
    status,
    linkText,
    selector,
    errors,
    reason: errors.length ? errors.join('; ') : null
  };
}

export function aggregateBrokenLinkDetails(details = []) {
  if (!Array.isArray(details)) return [];
  const grouped = new Map();
  for (const item of details) {
    const row = normalizeBrokenLinkRow(item);
    if (!row) continue;
    const key = `${row.sourcePageUrl ?? ''}\u0000${row.brokenUrl}`;
    const current = grouped.get(key) ?? { ...row, occurrences: 0, errors: [] };
    current.status = current.status === null ? row.status : Math.max(current.status ?? -Infinity, row.status ?? -Infinity);
    current.linkText = current.linkText ?? row.linkText;
    current.selector = current.selector ?? row.selector;
    current.errors = [...new Set([...(current.errors ?? []), ...(row.errors ?? [])])].sort((a, b) => a.localeCompare(b));
    current.reason = current.errors.length ? current.errors.join('; ') : null;
    current.occurrences += 1;
    grouped.set(key, current);
  }

  return [...grouped.values()].sort((a, b) =>
    (a.sourcePageUrl ?? '').localeCompare(b.sourcePageUrl ?? '')
    || a.brokenUrl.localeCompare(b.brokenUrl)
    || (a.status ?? -Infinity) - (b.status ?? -Infinity)
    || (a.reason ?? '').localeCompare(b.reason ?? '')
  );
}

function readDetailCandidates(report){
  if (!report || typeof report !== 'object') return [];
  const candidates = [
    report.details,
    report.items,
    report.brokenLinks,
    report.links,
    report.rows,
    report.results,
    report.failures
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

export function normalizeBrokenLinksReport(report = {}) {
  const details = readDetailCandidates(report);
  const rows = aggregateBrokenLinkDetails(details);

  const uniquePages = new Set(rows.map((row) => row.sourcePageUrl).filter(Boolean));
  const summary = report && typeof report.summary === 'object' && report.summary !== null ? report.summary : {};
  const checked = toNum(summary.checked ?? report.checkedCount ?? report.totalLinks ?? report.checked) ?? 0;
  const broken = toNum(summary.broken ?? report.brokenCount ?? report.broken) ?? rows.length;

  return {
    checked,
    broken,
    redirectChains: toNum(summary.redirectChains ?? report.redirectChains),
    loops: toNum(summary.loops ?? report.loops),
    pageCount: uniquePages.size,
    rows
  };
}

function renderLink(url){
  const text = formatUnknown(url);
  if (!url) return `<span>${escapeHtml(text)}</span>`;
  return `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer noopener">${escapeHtml(url)}</a>`;
}

export function bindBrokenLinks(scope){
  const filterInput = scope.querySelector('[data-broken-filter]');
  const rows = [...scope.querySelectorAll('[data-broken-row]')];
  const countTarget = scope.querySelector('[data-broken-visible-count]');
  if (!filterInput || rows.length === 0 || !countTarget) return;

  const applyFilter = () => {
    const query = String(filterInput.value ?? '').trim().toLowerCase();
    let visible = 0;
    for (const row of rows) {
      const haystack = String(row.dataset.brokenSearch ?? '').toLowerCase();
      const matched = !query || haystack.includes(query);
      row.hidden = !matched;
      if (matched) visible += 1;
    }
    countTarget.textContent = String(visible);
  };

  filterInput.oninput = applyFilter;
  applyFilter();
}

export function renderBroken(report = {}, options = {}) {
  if (options.artifactMissing) {
    return '<p class="inline-hint">No broken links artifact found in this run</p>';
  }

  const normalized = normalizeBrokenLinksReport(report);
  const rows = normalized.rows;

  const tableRows = rows.map((row) => {
    const errors = row.errors.length ? row.errors.map((error) => `<code>${escapeHtml(error)}</code>`).join('<br>') : MISSING;
    const search = [row.sourcePageUrl, row.brokenUrl, row.linkText, row.selector, row.status, row.reason].filter(Boolean).join(' ');
    return `<tr data-broken-row data-broken-search="${escapeHtml(search)}"><td>${renderLink(row.sourcePageUrl)}</td><td>${renderLink(row.brokenUrl)}</td><td>${escapeHtml(formatUnknown(row.linkText))}</td><td>${escapeHtml(formatUnknown(row.selector))}</td><td>${escapeHtml(formatUnknown(row.status))}</td><td>${errors}</td></tr>`;
  }).join('');

  const summary = `<div class="kpis">${metric('Checked', normalized.checked)}${metric('Broken', normalized.broken)}${metric('Redirect chains', normalized.redirectChains)}${metric('Loops', normalized.loops)}</div><p class="inline-hint">Broken links: ${formatCount(normalized.broken)} across ${formatCount(normalized.pageCount)} pages</p>`;

  if (rows.length === 0) {
    return `${summary}<p class="inline-hint">No broken links detected for this run.</p>`;
  }

  return `${summary}<label class="inline-hint" for="broken-links-filter">Filter broken URL</label><input id="broken-links-filter" data-broken-filter type="search" placeholder="Search broken URL or source page"><p class="inline-hint">Showing <span data-broken-visible-count>${rows.length}</span> of ${rows.length} rows</p><table><thead><tr><th>Source page</th><th>Broken URL</th><th>Link text</th><th>Selector</th><th>Status</th><th>Failure reason</th></tr></thead><tbody>${tableRows}</tbody></table>`;
}
