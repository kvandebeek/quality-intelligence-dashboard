const MISSING = 'Not available';

const toNum = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const escapeHtml = (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');

function asUrl(value){
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeError(value){
  if (typeof value === 'string' && value.trim()) return value.trim();
  return null;
}

export function aggregateBrokenLinkDetails(details = []) {
  if (!Array.isArray(details)) return [];
  const grouped = new Map();

  for (const raw of details) {
    if (!raw || typeof raw !== 'object') continue;
    const sourcePageUrl = asUrl(raw.sourcePageUrl);
    const brokenUrl = asUrl(raw.brokenUrl);
    if (!sourcePageUrl || !brokenUrl) continue;

    const key = `${sourcePageUrl}\u0000${brokenUrl}`;
    const current = grouped.get(key) ?? { sourcePageUrl, brokenUrl, status: null, errors: new Set(), occurrences: 0 };
    const status = toNum(raw.status);
    current.status = current.status === null ? status : Math.max(current.status, status ?? -Infinity);

    const singleError = normalizeError(raw.error);
    if (singleError) current.errors.add(singleError);
    if (Array.isArray(raw.errors)) {
      for (const item of raw.errors) {
        const nextError = normalizeError(item);
        if (nextError) current.errors.add(nextError);
      }
    }

    current.occurrences += 1;
    grouped.set(key, current);
  }

  return [...grouped.values()]
    .map((entry) => ({
      sourcePageUrl: entry.sourcePageUrl,
      brokenUrl: entry.brokenUrl,
      status: entry.status,
      errors: [...entry.errors].sort((a, b) => a.localeCompare(b)),
      occurrences: entry.occurrences
    }))
    .sort((a, b) =>
      a.sourcePageUrl.localeCompare(b.sourcePageUrl)
      || a.brokenUrl.localeCompare(b.brokenUrl)
      || (toNum(b.status) ?? -Infinity) - (toNum(a.status) ?? -Infinity)
      || a.errors.join(' | ').localeCompare(b.errors.join(' | '))
    );
}

function fmt(value){
  const n = toNum(value);
  if (n === null) return MISSING;
  const rounded = Number.isInteger(n) ? n : Number(n.toFixed(2));
  return String(rounded);
}

function kpi(label, value){
  return `<div class="kpi"><span>${label}</span><strong>${fmt(value)}</strong></div>`;
}

export function renderBroken(report = {}) {
  const rows = aggregateBrokenLinkDetails(report.details);
  const legacyDetailPresent = Array.isArray(report.details) && report.details.length > 0 && rows.length === 0;
  const hasRows = rows.length > 0;
  const headers = '<tr><th>Source page</th><th>Broken URL</th><th>Status</th><th>Errors</th></tr>';
  const body = rows.map((row) => {
    const errors = row.errors.length ? row.errors.map((item) => `<code>${escapeHtml(item)}</code>`).join('<br>') : MISSING;
    return `<tr><td><a href="${escapeHtml(row.sourcePageUrl)}" target="_blank" rel="noreferrer noopener">${escapeHtml(row.sourcePageUrl)}</a></td><td><a href="${escapeHtml(row.brokenUrl)}" target="_blank" rel="noreferrer noopener">${escapeHtml(row.brokenUrl)}</a></td><td>${fmt(row.status)}</td><td>${errors}</td></tr>`;
  }).join('');

  const emptyState = hasRows
    ? ''
    : '<p class="inline-hint">No broken-link detail rows available.</p>';
  const legacyNote = legacyDetailPresent
    ? '<p class="inline-hint">Legacy detail format detected; source/broken URL pairs are unavailable.</p>'
    : '';

  return `<div class="kpis">${kpi('Checked', report.checkedCount ?? report.checked)}${kpi('Broken', report.brokenCount ?? report.broken)}${kpi('Redirect chains', report.redirectChains)}${kpi('Loops', report.loops)}</div>${legacyNote}${emptyState}<table><thead>${headers}</thead><tbody>${body}</tbody></table>`;
}
