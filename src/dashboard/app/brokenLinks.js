const MISSING = 'unknown';
const NON_FAILURE_MARKERS = new Set(['none', 'ok', 'success', 'pass']);

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
  return [...new Set(found.map((value) => value.trim()).filter((value) => value && !NON_FAILURE_MARKERS.has(value.toLowerCase())))].sort((a, b) => a.localeCompare(b));
}

function classifyFailureReason(status, errors){
  if (errors.length > 0) return errors;
  if (status === null) return [];
  if (status === 401) return ['unauthorized'];
  if (status === 403) return ['forbidden'];
  if (status === 404) return ['not_found'];
  if (status === 410) return ['gone'];
  if (status >= 500) return ['server_error'];
  if (status >= 400) return ['http_error'];
  return [];
}

function isBrokenLinkRow(row){
  return (typeof row.status === 'number' && row.status >= 400) || row.errors.length > 0;
}

function normalizeScreenshot(screenshot){
  if (!screenshot || typeof screenshot !== 'object') return null;
  const type = typeof screenshot.type === 'string' ? screenshot.type : 'none';
  const path = asUrl(screenshot.path);
  const thumbnailPath = asUrl(screenshot.thumbnailPath);
  return {
    type,
    path,
    thumbnailPath,
    error: asText(screenshot.error)
  };
}

export function normalizeBrokenLinkRow(raw){
  if (!raw || typeof raw !== 'object') return null;
  const sourcePageUrl = asUrl(raw.sourcePageUrl ?? raw.sourceUrl ?? raw.pageUrl ?? raw.page ?? raw.referrerUrl ?? raw.parentUrl);
  const brokenUrl = asUrl(raw.brokenUrl ?? raw.url ?? raw.linkUrl ?? raw.href ?? raw.targetUrl ?? raw.destinationUrl);
  if (!brokenUrl) return null;

  const rawStatus = raw.statusCode ?? raw.status ?? raw.httpStatus ?? raw.code;
  const status = toNum(rawStatus);
  const linkText = asText(raw.linkText ?? raw.anchorText ?? raw.text ?? raw.label);
  const selector = asText(raw.selector ?? raw.cssSelector ?? raw.xpath);
  const errors = readErrors(raw);
  const statusLabel = typeof rawStatus === 'string' ? rawStatus.trim().toLowerCase() : null;

  if (status === null && statusLabel && !NON_FAILURE_MARKERS.has(statusLabel)) {
    if (statusLabel.includes('timeout')) errors.push('null_response');
    else if (statusLabel.includes('dns')) errors.push('dns_error');
    else if (statusLabel.includes('network')) errors.push('network_error');
  }

  const normalizedErrors = classifyFailureReason(status, [...new Set(errors)]);

  return {
    sourcePageUrl,
    brokenUrl,
    status,
    linkText,
    selector,
    errors: normalizedErrors,
    reason: normalizedErrors.length ? normalizedErrors.join('; ') : null,
    screenshot: normalizeScreenshot(raw.screenshot)
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
    if (!current.screenshot?.thumbnailPath && row.screenshot?.thumbnailPath) current.screenshot = row.screenshot;
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
  const rows = aggregateBrokenLinkDetails(details).filter(isBrokenLinkRow);

  const uniquePages = new Set(rows.map((row) => row.sourcePageUrl).filter(Boolean));
  const summary = report && typeof report.summary === 'object' && report.summary !== null ? report.summary : {};
  const checked = toNum(summary.checked ?? report.checkedCount ?? report.totalLinks ?? report.checked) ?? 0;
  const broken = rows.length;

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

function previewCell(row, runId){
  if (!row.screenshot) return '<span class="badge">No preview</span>';
  if (row.screenshot.thumbnailPath && row.screenshot.path) {
    const thumb = `/artifacts/${encodeURIComponent(runId)}/${row.screenshot.thumbnailPath}`;
    const full = `/artifacts/${encodeURIComponent(runId)}/${row.screenshot.path}`;
    const fallbackBadge = row.screenshot.type === 'fullpage' ? '<div class="inline-hint">Fallback</div>' : '';
    return `<button class="preview-trigger" data-preview-open data-preview-title="${escapeHtml(row.brokenUrl)}" data-preview-full="${escapeHtml(full)}"><img src="${escapeHtml(thumb)}" alt="Broken link preview thumbnail">${fallbackBadge}</button>`;
  }
  if (row.screenshot.type === 'fullpage') return '<span class="badge">Fallback</span>';
  return '<span class="badge">No preview</span>';
}

export function bindBrokenLinks(scope){
  const filterInput = scope.querySelector('[data-broken-filter]');
  const rows = [...scope.querySelectorAll('[data-broken-row]')];
  const countTarget = scope.querySelector('[data-broken-visible-count]');

  if (filterInput && rows.length > 0 && countTarget) {
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

  const modal = scope.querySelector('[data-broken-preview-modal]');
  if (!modal) return;
  const modalImage = modal.querySelector('[data-broken-preview-image]');
  const modalTitle = modal.querySelector('[data-broken-preview-title]');
  const modalOpenLink = modal.querySelector('[data-broken-preview-open-tab]');
  scope.querySelectorAll('[data-preview-open]').forEach((button) => {
    button.addEventListener('click', () => {
      const full = button.getAttribute('data-preview-full');
      const title = button.getAttribute('data-preview-title') ?? 'Broken link preview';
      if (!full || !modalImage) return;
      modalImage.setAttribute('src', full);
      modalImage.setAttribute('alt', title);
      modalOpenLink?.setAttribute('href', full);
      if (modalTitle) modalTitle.textContent = title;
      modal.showModal();
    });
  });

  modal.addEventListener('click', (event) => {
    if (event.target === modal) modal.close();
  });
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
    return `<tr data-broken-row data-broken-search="${escapeHtml(search)}"><td>${renderLink(row.sourcePageUrl)}</td><td>${renderLink(row.brokenUrl)}</td><td>${escapeHtml(formatUnknown(row.linkText))}</td><td>${escapeHtml(formatUnknown(row.selector))}</td><td>${escapeHtml(formatUnknown(row.status))}</td><td>${errors}</td><td>${previewCell(row, options.runId ?? '')}</td></tr>`;
  }).join('');

  const summary = `<div class="kpis">${metric('Checked', normalized.checked)}${metric('Broken', normalized.broken)}${metric('Redirect chains', normalized.redirectChains)}${metric('Loops', normalized.loops)}</div><p class="inline-hint">Broken links: ${formatCount(normalized.broken)} across ${formatCount(normalized.pageCount)} pages</p>`;

  if (rows.length === 0) {
    return `${summary}<p class="inline-hint">No broken links detected for this run.</p>`;
  }

  return `${summary}<label class="inline-hint" for="broken-links-filter">Filter broken URL</label><input id="broken-links-filter" data-broken-filter type="search" placeholder="Search broken URL or source page"><p class="inline-hint">Showing <span data-broken-visible-count>${rows.length}</span> of ${rows.length} rows</p><table><thead><tr><th>Source page</th><th>Broken URL</th><th>Link text</th><th>Selector</th><th>Status</th><th>Failure reason</th><th>Preview</th></tr></thead><tbody>${tableRows}</tbody></table><dialog class="broken-links-modal" data-broken-preview-modal><form method="dialog"><button class="link" aria-label="Close preview">Close</button></form><h3 data-broken-preview-title>Broken link preview</h3><div class="broken-links-modal-body"><img data-broken-preview-image alt="Broken link preview"></div><p><a data-broken-preview-open-tab target="_blank" rel="noreferrer noopener">Open in new tab</a></p></dialog>`;
}
