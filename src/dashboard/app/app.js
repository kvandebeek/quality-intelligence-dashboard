import { applyTheme, getInitialTheme, toggleTheme } from './theme.js';
import { buildStabilityRows } from './stability.js';
import { bindBrokenLinks, renderBroken } from './brokenLinks.js';

const app = document.getElementById('app');

const state = {
  index: null,
  sections: null,
  selectedId: null,
  selectedTab: 'target-summary.json',
  search: '',
  regex: false,
  theme: getInitialTheme(),
  selectedDomain: null,
  selectedView: 'domain-overview',
  domainSummary: null,
  facets: { failures:false, broken:false, visualFailed:false, throttled:false, a11y:new Set() },
  sorts: { stability: { key: 'index', dir: 'asc' } },
  a11yContrastFindings: []
};

const MISSING = 'Not available';
const STABILITY_SLOW_ABSOLUTE_MS = 1000;
const STABILITY_SLOW_RELATIVE_MULTIPLIER = 1.2;

const safe = (v, fallback=MISSING) => {
  if (v === 'not measured') return v;
  if (v === null || v === undefined || v === '' || v === 'null') return fallback;
  return v;
};
const toNum = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);


const CWV_NEEDS_IMPROVEMENT_LABEL = 'Needs improvement';
const SECURITY_NOT_COLLECTED_HELP = 'Not collected means the security scan was disabled, missing, or did not produce severity counts.';

function renderHelpTip(text){
  return `<span class="help-tip" role="img" aria-label="${text}" title="${text}">i</span>`;
}

function normalizeDomainLink(value, options = {}){
  if(typeof value !== 'string' || !value.trim()) return { displayDomain: null, domainHref: null };
  const { preferOrigin = false } = options;
  const trimmed = value.trim();
  const parse = (input)=>{
    try { return new URL(input); } catch { return null; }
  };
  const parsed = parse(trimmed) ?? parse(`https://${trimmed}`);
  if(!parsed || !parsed.hostname) return { displayDomain: null, domainHref: null };
  const normalizedHref = `${parsed.protocol}//${parsed.host}${parsed.pathname || '/'}${parsed.search}${parsed.hash}`;
  const domainHref = parsed.protocol === 'https:' || parsed.protocol === 'http:' ? normalizedHref : null;
  if(!domainHref) return { displayDomain: null, domainHref: null };
  const displayDomain = preferOrigin
    ? `${parsed.protocol}//${parsed.host}/`
    : (parse(trimmed) ? trimmed : `${parsed.protocol}//${parsed.host}/`);
  return { displayDomain, domainHref };
}

function renderDomainLink(value, options = {}){
  const { fallback = null } = options;
  const normalized = normalizeDomainLink(value, options);
  if(!normalized.domainHref || !normalized.displayDomain) return fallback;
  return `<a class="domain-title-link" href="${escapeHtml(normalized.domainHref)}" target="_blank" rel="noopener noreferrer">${escapeHtml(normalized.displayDomain)}</a>`;
}


function formatDataPath(runPath){
  if(typeof runPath !== 'string' || !runPath.trim()) return './artifacts';
  const normalized = runPath.replace(/\\/g, '/');
  if(normalized.startsWith('./') || normalized.startsWith('../')) return normalized;
  if(normalized.startsWith('/')) return normalized;
  return `./${normalized}`;
}

function formatUrlDataPath(entry){
  const runPath = typeof state.index?.runPath === 'string' ? state.index.runPath : '';
  const folderName = typeof entry?.folderName === 'string' ? entry.folderName : '';
  const combined = [runPath, folderName].filter(Boolean).join('/');
  return formatDataPath(combined || runPath);
}

function renderDomainHeader(data){
  const heading = renderDomainLink(data.displayDomain, { fallback: escapeHtml(data.title) }) ?? escapeHtml(data.title);
  return `<header class="detail-header domain-header">
    <h2>${heading}</h2>
    <div class="meta">Data path: ${escapeHtml(formatDataPath(data.dataPath))}</div>
    <div class="top-issues">${data.topIssues.map((item)=>`<span>${item}</span>`).join('')}</div>
  </header>`;
}


function issueTargetLabel(target){
  if (typeof target === 'string') return target;
  if (target && typeof target === 'object') return safe(target.selector ?? MISSING);
  return MISSING;
}

function renderIssueTargets(targets, issue = null){
  if (!Array.isArray(targets) || targets.length === 0) return '';
  const labels = targets.map((target)=>issueTargetLabel(target)).filter((label)=>label && label !== MISSING);
  if (labels.length === 0) return '';
  const visible = labels.slice(0, 10);
  const remaining = labels.length - visible.length;
  const items = visible.map((label)=>`<li><code>${safe(label)}</code></li>`).join('');
  const more = remaining > 0 ? `<li>+${remaining} more</li>` : '';
  const hasVisualization = issue?.visualization?.annotatedScreenshotPath && issue?.visualization?.metaPath;
  const viewBtn = hasVisualization
    ? `<button type="button" class="btn-mini issue-visualization-btn" data-screenshot-path="${encodeURIComponent(issue.visualization.annotatedScreenshotPath)}" data-meta-path="${encodeURIComponent(issue.visualization.metaPath)}" data-issue-title="${encodeURIComponent(issue.title ?? issue.id ?? 'Issue visualization')}">View on screenshot</button>`
    : '';
  return `<details class="issue-targets"><summary>Targets (${labels.length})</summary><ul>${items}${more}</ul></details>${viewBtn}`;
}

function renderIssueVisualizationModal(){
  return `<dialog class="ux-issue-modal"><form method="dialog"><button class="link">Close</button></form><div class="ux-issue-modal-body"></div></dialog>`;
}

function metricGoodRate(metric){
  const measured = toNum(metric?.measured) ?? 0;
  const good = toNum(metric?.good) ?? 0;
  if(measured===0) return 'Not collected';
  return `${Math.round((good/measured)*100)}% Good (${good}/${measured})`;
}

const CLIENT_RUN_ID = (()=>{ try { return crypto.randomUUID(); } catch { return `client-${Date.now()}`; } })();

function createOperationId(){
  try { return crypto.randomUUID(); } catch { return `op-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
}

async function logEvent(level, message, context = {}){
  const payload = { level, message, context: { runId: CLIENT_RUN_ID, ...context } };
  try {
    await fetch('/api/log', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(payload) });
  } catch {
    // intentionally ignored
  }
}

function summarizeInput(value){
  const text = String(value ?? '');
  return { length: text.length, hasWhitespace: /\s/.test(text) };
}

function parseTabFromHash(){
  const raw = window.location.hash.replace(/^#\/?/, '').trim();
  if(!raw || !state.sections) return null;
  const target = decodeURIComponent(raw).toLowerCase();
  if(target === 'domain-overview') return 'domain-overview';
  return state.sections.order.find((section)=>{
    const definition = state.sections.definitions[section];
    if(!definition) return false;
    return section.toLowerCase() === target || String(definition.label).toLowerCase() === target;
  }) ?? null;
}

function tabToHash(tab){
  const label = state.sections?.definitions?.[tab]?.label ?? tab;
  return `#/${encodeURIComponent(label)}`;
}

function selectedCategory(){
  return state.sections?.categories.find((category)=>category.sections.includes(state.selectedTab)) ?? state.sections?.categories[0] ?? null;
}

function syncTabFromLocation(){
  const fromHash = parseTabFromHash();
  if(fromHash === 'domain-overview'){
    if(state.selectedView !== 'domain-overview'){
      state.selectedView='domain-overview';
      return true;
    }
    return false;
  }
  if(fromHash && (fromHash !== state.selectedTab || state.selectedView !== 'url')){
    state.selectedView='url';
    state.selectedTab = fromHash;
    return true;
  }
  return false;
}

function setSelectedTab(nextTab, options = { pushHash: true }){
  if(nextTab === state.selectedTab && !options.pushHash) return;
  state.selectedTab = nextTab;
  if(options.pushHash){
    const nextHash = tabToHash(nextTab);
    if(window.location.hash !== nextHash) window.location.hash = nextHash;
  }
}

async function loadSectionConfig(){
  const res = await fetch('/api/sections');
  if(!res.ok) throw new Error(`Failed to load section config: ${res.status}`);
  state.sections = await res.json();
  const validTabs = new Set(state.sections.order);
  const hashTab = parseTabFromHash();
  if(hashTab === 'domain-overview'){ state.selectedView='domain-overview'; state.selectedTab = state.sections.order[0]; }
  else { state.selectedTab = hashTab && validTabs.has(hashTab) ? hashTab : state.sections.order[0]; }
}

async function loadIndex(){
  const opId = createOperationId();
  const started = performance.now();
  await logEvent('INFO', 'UI index load started', { operationId: opId, view: 'index' });
  const [indexRes] = await Promise.all([fetch('/api/index'), loadSectionConfig(), loadDomainSummary()]);
  if(!indexRes.ok) throw new Error(`Failed to load index: ${indexRes.status}`);
  state.index = await indexRes.json();
  state.selectedId = state.index.urls[0]?.id ?? null;
  await logEvent('INFO', 'UI index load completed', { operationId: opId, view: 'index', count: state.index.urls.length, durationMs: Math.round(performance.now()-started) });
  render();
}

function filterUrls(){
  if(!state.index) return [];
  return state.index.urls.filter((u)=>{
    const target = `${u.url} ${u.folderName}`;
    const q = state.search.trim();
    const match = !q ? true : (state.regex ? new RegExp(q,'i').test(target) : target.toLowerCase().includes(q.toLowerCase()));
    if(!match) return false;
    if(state.facets.failures && !u.hasFailures) return false;
    if(state.facets.broken && (u.sections['broken-links.json']?.summary?.brokenCount ?? 0) <= 0) return false;
    if(state.facets.visualFailed && u.sections['visual-regression.json']?.summary?.passed !== false) return false;
    if(state.facets.throttled && u.sections['throttled-run.json']?.state === 'missing') return false;
    if(state.facets.a11y.size){
      const sev = u.sections['accessibility.json']?.summary || {};
      const has = [...state.facets.a11y].some((s)=> (sev[s] ?? 0) > 0);
      if(!has) return false;
    }
    return true;
  });
}


async function loadDomainSummary(){
  const res = await fetch('/api/domain-overview');
  if(!res.ok) throw new Error(`Failed to load domain overview: ${res.status}`);
  state.domainSummary = await res.json();
}

function coverageText(coverage){
  if(!coverage) return 'Based on 0/0 URLs';
  return `Based on ${coverage.measured}/${coverage.total} URLs`;
}

function fmtSeconds(v){
  const n = toNum(v);
  return n===null ? 'Not measured' : `${n.toFixed(1)} s`;
}

function valueOrNotMeasured(v, formatter=(x)=>String(x)){
  const n = toNum(v);
  return n===null ? 'Not measured' : formatter(n);
}

function fcpBandClass(seconds){
  const n = toNum(seconds);
  if(n===null) return 'band-na';
  if(n<=1.8) return 'band-good';
  if(n<=2.5) return 'band-warn';
  if(n<=3.0) return 'band-mid';
  return 'band-bad';
}


function fcpAttemptBreakdown(attempts = [], reportedMs){
  if(!Array.isArray(attempts) || attempts.length===0) return '';
  const attemptText = attempts
    .map((entry)=>`Attempt ${entry.attempt}: ${entry.fcpMs===null || entry.fcpMs===undefined ? 'n/a' : `${(entry.fcpMs/1000).toFixed(1)}s`}`)
    .join(', ');
  const reported = reportedMs===null || reportedMs===undefined ? 'n/a' : `${(reportedMs/1000).toFixed(1)}s`;
  return `${attemptText} → Reported: ${reported} (median)`;
}

function cwvStoplight(metric, rawValue){
  const value = toNum(rawValue);
  if(metric==='LCP'){
    if(value===null) return {state:'missing',label:'Not measured'};
    if(value<=2500) return {state:'good',label:'Good'};
    if(value<=4000) return {state:'needs',label:'Needs improvement'};
    return {state:'poor',label:'Poor'};
  }
  if(metric==='INP'){
    if(value===null) return {state:'missing',label:'Not measured'};
    if(value<=200) return {state:'good',label:'Good'};
    if(value<=500) return {state:'needs',label:'Needs improvement'};
    return {state:'poor',label:'Poor'};
  }
  if(value===null) return {state:'missing',label:'Not measured'};
  if(value<=0.1) return {state:'good',label:'Good'};
  if(value<=0.25) return {state:'needs',label:'Needs improvement'};
  return {state:'poor',label:'Poor'};
}

function renderCwvStoplights(cwv={}){
  const cards = [
    {metric:'LCP', value: toNum(cwv.metrics?.lcp?.medianMs), display: valueOrNotMeasured(toNum(cwv.metrics?.lcp?.medianMs), (n)=>`${(n/1000).toFixed(2)}s`)},
    {metric:'INP', value: toNum(cwv.metrics?.inp?.medianMs), display: valueOrNotMeasured(toNum(cwv.metrics?.inp?.medianMs), (n)=>`${Math.round(n)}ms`)},
    {metric:'CLS', value: toNum(cwv.metrics?.cls?.median), display: valueOrNotMeasured(toNum(cwv.metrics?.cls?.median), (n)=>n.toFixed(3))}
  ];
  return `<div class="cwv-stoplights">${cards.map((card)=>{ const stop = cwvStoplight(card.metric, card.value); return `<div class="cwv-stoplight"><span class="metric">${card.metric}</span><span class="value">${card.display}</span><span class="light ${stop.state}" aria-hidden="true"></span><span class="label">${stop.label}</span></div>`; }).join('')}</div>`;
}

function renderDonut(segments, total, options={}){
  if(!total) return '<div class="donut-empty">Not measured</div>';
  let acc = 0;
  const arcs = segments.map((seg)=>{
    const pct = (seg.value/total)*100;
    const start = acc;
    const end = acc + pct;
    acc = end;
    return `<span class="donut-segment" data-segment="${escapeHtml(seg.label)}" style="--segment-start:${start.toFixed(2)}%;--segment-end:${end.toFixed(2)}%;--segment-color:${seg.color}"></span>`;
  }).join('');
  const interactive = options.interactive ? ' donut-interactive' : '';
  const tile = options.tile ? ` data-interactive-donut="${options.tile}"` : '';
  return `<div class="donut${interactive}"${tile}>${arcs}<span class="donut-hole" aria-hidden="true"></span></div>`;
}


function renderDomainOverview(selected){
  const s = state.domainSummary;
  if(!s) return '<section class="domain-grid"><article class="summary-card">Loading domain overview…</article></section>';
  const a11yTotal = toNum(s.accessibility?.totalIssues) ?? 0;
  const a11yCounts = s.accessibility?.counts || {};
  const a11ySegments = [
    {label:'critical', value:toNum(a11yCounts.critical)??0, color:'var(--sev-critical)'},
    {label:'serious', value:toNum(a11yCounts.serious)??0, color:'var(--sev-serious)'},
    {label:'moderate', value:toNum(a11yCounts.moderate)??0, color:'var(--sev-moderate)'},
    {label:'minor', value:toNum(a11yCounts.minor)??0, color:'var(--sev-minor)'}
  ];

  const cwv = s.coreWebVitals || {};
  const cwvState = cwv.state || 'not-collected';
  const cwvTotal = (toNum(cwv.good)??0)+(toNum(cwv.needsImprovement)??0)+(toNum(cwv.poor)??0);
  const cwvSegments = [
    {label:'Good', value:toNum(cwv.good)??0, color:'var(--success)'},
    {label:CWV_NEEDS_IMPROVEMENT_LABEL, value:toNum(cwv.needsImprovement)??0, color:'var(--warning)'},
    {label:'Poor', value:toNum(cwv.poor)??0, color:'var(--danger)'}
  ];

  const sec = s.security || {};
  const secState = sec.state || 'not-collected';
  const secTotal = toNum(sec.totalFindings) ?? 0;
  const secSev = sec.severities || {};
  const secSegments = Object.entries(secSev).map(([label,val],i)=>({label,value:toNum(val)??0,color:["#ef4444","#f59e0b","#eab308","#60a5fa","#a78bfa"][i%5]}));
  const secPrimary = secState === 'not-collected' ? `Not collected ${renderHelpTip(SECURITY_NOT_COLLECTED_HELP)}` : secState === 'ok-empty' ? 'No security findings' : `${secTotal}`;
  const secSecondary = secState === 'ok-has-findings' ? secSegments.map((x)=>`${x.label}: ${x.value}`).join(' · ') : 'No findings';

  const ux = s.uxSummary || {};
  const uxTopIssues = Array.isArray(ux.topIssues) ? ux.topIssues : [];
  const uxSecondary = ux.state === 'has-issues'
    ? uxTopIssues.slice(0,3).map((issue)=>`${issue.title} (${issue.count})`).join(' · ')
    : ux.state === 'empty' ? 'No UI/UX issues detected' : `Not collected ${renderHelpTip('UI/UX checks were not available for this run.')}`;

  const cb = s.crossBrowserPerformance || {};
  const cbPrimary = cb.state === 'tested'
    ? 'Tested'
    : cb.state === 'partial'
      ? 'Partial'
      : 'Untested';

  const normalizedDomain = normalizeDomainLink(s.startUrl ?? s.domain, { preferOrigin: true });
  const header = renderDomainHeader({
    title: normalizedDomain.displayDomain ?? 'Domain overview',
    displayDomain: normalizedDomain.displayDomain,
    domainHref: normalizedDomain.domainHref,
    runTime: selected?.runTime,
    runId: selected?.runId,
    dataPath: s.runPath,
    topIssues: [
      `URLs scanned: ${toNum(s.totals?.urls) ?? 0}`,
      `A11y issues: ${a11yTotal}`,
      `Broken links: ${toNum(s.brokenLinks?.broken) ?? 0}`,
      `Security findings: ${secState === 'not-collected' ? 'Not collected' : secTotal}`,
      `Client-side errors: ${toNum(s.clientErrors?.totalErrors) ?? 0}`,
      `Cross-browser performance: ${cbPrimary}`
    ]
  });

  return `${header}<section class="domain-grid" aria-label="Domain overview tiles">
    <button type="button" class="summary-card summary-card-link" data-tile="accessibility-severity" data-testid="domain-overview-accessibility-severity" data-nav-hash="#/accessibility" aria-label="Go to accessibility"><h3>Accessibility issues severity</h3>${renderDonut(a11ySegments, a11yTotal, { interactive: true, tile: 'accessibility-severity' })}<p class="primary">${a11yTotal} total issues</p><p class="secondary"><span class="severity-label severity-critical" data-severity="critical" tabindex="0">critical</span> ${a11ySegments[0].value} · <span class="severity-label severity-serious" data-severity="serious" tabindex="0">serious</span> ${a11ySegments[1].value} · <span class="severity-label severity-moderate" data-severity="moderate" tabindex="0">moderate</span> ${a11ySegments[2].value} · <span class="severity-label severity-minor" data-severity="minor" tabindex="0">minor</span> ${a11ySegments[3].value}</p><p class="coverage">${coverageText(s.accessibility?.coverage)}</p></button>
    <button type="button" class="summary-card summary-card-link" data-tile="fcp-counter" data-testid="domain-overview-fcp" data-nav-hash="#/performance" aria-label="Go to performance"><h3>Content load: FCP</h3><p class="primary ${fcpBandClass(s.fcp?.avgSeconds)}">${fmtSeconds(s.fcp?.avgSeconds)}</p><p class="secondary">Min ${fmtSeconds(s.fcp?.minSeconds)} · Max ${fmtSeconds(s.fcp?.maxSeconds)}</p><p class="secondary">Issues ${toNum(s.fcp?.issues)??0} · Intermittent ${toNum(s.fcp?.intermittent)??0}</p><p class="coverage">${coverageText(s.fcp?.coverage)}</p></button>
    <article class="summary-card" data-tile="broken-links" data-nav-tab="broken-links.json"><h3>Broken links</h3><p class="primary">${toNum(s.brokenLinks?.broken) ?? 'Not measured'}</p><p class="secondary">${toNum(s.brokenLinks?.broken)??0}/${toNum(s.brokenLinks?.total)??0} broken/total</p><p class="coverage">${coverageText(s.brokenLinks?.coverage)}</p></article>
    <button type="button" class="summary-card summary-card-link" data-tile="seo-score" data-testid="domain-overview-seo-score" data-nav-hash="#/seo-score" aria-label="Go to SEO score"><h3>SEO score</h3><p class="primary">${valueOrNotMeasured(s.seoScore?.avg,(n)=>n.toFixed(0))}</p><p class="secondary">Min ${valueOrNotMeasured(s.seoScore?.min,(n)=>n.toFixed(0))} · Max ${valueOrNotMeasured(s.seoScore?.max,(n)=>n.toFixed(0))}</p><p class="coverage">${coverageText(s.seoScore?.coverage)}</p></button>

    <button type="button" class="summary-card summary-card-link" data-tile="cwv-status-by-metric" data-testid="domain-overview-cwv-status-by-metric" data-nav-hash="#/core-web-vitals" aria-label="Go to Core Web Vitals"><h3>Core Web Vitals status by metric</h3>${cwvState==='has-data'?renderCwvStoplights(cwv):`<div class="donut-empty">${cwvState==='empty'?'No data':'Not collected'}</div>`}<p class="coverage">${coverageText(cwv.coverage)}</p></button>
    <article class="summary-card" data-tile="client-errors" data-nav-tab="stability.json"><h3>Client-side errors</h3><p class="primary">${toNum(s.clientErrors?.totalErrors) ?? 'Not measured'}</p><p class="secondary">${toNum(s.clientErrors?.affectedUrls)??0} URLs with errors</p><p class="coverage">${coverageText(s.clientErrors?.coverage)}</p></article>
    <article class="summary-card" data-tile="security-findings" data-nav-tab="security-scan.json"><h3>Security findings by severity</h3>${secState==='ok-has-findings'?renderDonut(secSegments, secTotal):'<div class="donut-empty">No findings</div>'}<p class="primary">${secPrimary}</p><p class="secondary">${secState==='not-collected'?'Not collected':secTotal===0?'0 findings':secSecondary}</p><p class="coverage">${coverageText(sec.coverage)}</p></article>
    <article class="summary-card" data-tile="ux-summary" data-nav-tab="ux-overview.json"><h3>UI/UX checks summary</h3><p class="primary">${ux.state==='not-collected'?'Not collected':`${toNum(ux.passingUrls)??0} pass · ${toNum(ux.failingUrls)??0} fail`}</p><p class="secondary">${uxSecondary}</p><p class="coverage">${coverageText(ux.coverage)}</p></article>
  </section>`;
}

function render(options = {}){
  const renderStart = performance.now();
  if(!state.index || !state.sections){ app.innerHTML = '<p>Loading…</p>'; return; }
  const urls = filterUrls();
  const selected = urls.find((u)=>u.id===state.selectedId) ?? state.index.urls.find((u)=>u.id===state.selectedId) ?? urls[0];
  if(selected) state.selectedId = selected.id;
  app.innerHTML = `
  <div class="layout">
    <aside class="left">
      <div class="search-block">
        <input id="search" placeholder="Search URL or folder" value="${state.search.replace(/"/g,'&quot;')}">
        <label><input type="checkbox" id="regex" ${state.regex?'checked':''}> Regex</label>
        <button id="toggle-verbose" class="btn-mini">Verbose logging</button>
        <button id="export-diagnostics" class="btn-mini">Export diagnostics</button>
      </div>
      <div class="facets">
        <label><input type="checkbox" id="f-fail" ${state.facets.failures?'checked':''}> Has failures</label>
        <label><input type="checkbox" id="f-broken" ${state.facets.broken?'checked':''}> Broken links &gt; 0</label>
        <label><input type="checkbox" id="f-visual" ${state.facets.visualFailed?'checked':''}> Visual regression failed</label>
        <label><input type="checkbox" id="f-throttle" ${state.facets.throttled?'checked':''}> Throttled run available</label>
        <div class="facet-inline">A11y severity:
          ${['critical','serious','moderate','minor'].map(s=>`<button class="pill ${state.facets.a11y.has(s)?'on':''}" data-sev="${s}">${s}</button>`).join('')}
        </div>
      </div>
      <div class="domain-overview-block"><button id="domain-overview-btn" class="url-row domain-overview-row ${state.selectedView==='domain-overview' ? 'active domain-overview-active' : ''}" type="button" aria-pressed="${state.selectedView==='domain-overview' ? 'true' : 'false'}"><div class="title">Domain overview</div><div class="subtitle">All checked URLs</div></button></div><div id="url-list" class="url-list"></div>
      <div class="theme-block">
        <span class="theme-label">Theme</span>
        <button
          id="theme-toggle"
          type="button"
          class="theme-toggle"
          role="switch"
          aria-label="Theme"
          aria-checked="${state.theme === 'dark' ? 'true' : 'false'}"
        >
          <span aria-hidden="true">${state.theme === 'dark' ? '🌙 Dark' : '☀️ Light'}</span>
        </button>
      </div>
    </aside>
    <main class="main">${state.selectedView==='domain-overview' ? renderDomainOverview(selected) : (selected?renderDetailsShell(selected):'<p>No URLs match filters.</p>')}</main>
  </div>`;

  bindFilters();
  renderVirtualList(urls);
  const domainBtn=document.getElementById('domain-overview-btn');
  if(domainBtn){domainBtn.onclick=()=>{state.selectedView='domain-overview'; if(window.location.hash!=='#/domain-overview') window.location.hash='#/domain-overview'; render();};}
  document.querySelectorAll('[data-nav-tab]').forEach((el)=>el.onclick=()=>{
    const nextTab = el.getAttribute('data-nav-tab');
    if(!nextTab || !selected) return;
    state.selectedView='url';
    state.selectedId = selected.id;
    setSelectedTab(nextTab);
    render();
  });
  document.querySelectorAll('[data-severity]').forEach((el)=>{
    const apply = ()=>{
      const tile = el.closest('[data-tile]');
      const donut = tile?.querySelector('.donut-interactive');
      if(donut) donut.setAttribute('data-active-segment', (el.getAttribute('data-severity') || '').toLowerCase());
    };
    const clear = ()=>{
      const tile = el.closest('[data-tile]');
      const donut = tile?.querySelector('.donut-interactive');
      if(donut) donut.removeAttribute('data-active-segment');
    };
    el.addEventListener('mouseenter', apply);
    el.addEventListener('mouseleave', clear);
    el.addEventListener('focus', apply);
    el.addEventListener('blur', clear);
  });
  document.querySelectorAll('[data-nav-hash]').forEach((el)=>el.onclick=()=>{
    const nextHash = el.getAttribute('data-nav-hash');
    if(!nextHash) return;
    if(window.location.hash !== nextHash) window.location.hash = nextHash;
    syncTabFromLocation();
    render();
  });
  if(selected && state.selectedView!=='domain-overview') bindTabEvents(selected);

  const renderDuration = Math.round(performance.now() - renderStart);
  logEvent(renderDuration > 500 ? 'WARN' : 'DEBUG', 'UI render completed', { view: state.selectedTab, durationMs: renderDuration, selectedId: state.selectedId });

  if(options.preserveSearchFocus){
    const searchInput = document.getElementById('search');
    if(searchInput){
      const caret = state.search.length;
      searchInput.focus();
      searchInput.setSelectionRange(caret, caret);
    }
  }
}

function badge(s){ return `<span class="b ${s}">${s==='issues'?'!':s==='ok'?'✓':'·'}</span>`; }

function renderVirtualList(urls){
  const container = document.getElementById('url-list');
  const rowH = 68;
  const renderRows = ()=>{
    const h = container.clientHeight || 600;
    const start = Math.floor(container.scrollTop / rowH);
    const visible = Math.ceil(h / rowH) + 8;
    const slice = urls.slice(start, start+visible);
    container.innerHTML = `<div style="height:${urls.length*rowH}px;position:relative">${slice.map((u,i)=>{
      const top=(start+i)*rowH;
      return `<button class="url-row ${u.id===state.selectedId?'active':''}" data-id="${u.id}" style="top:${top}px">
        <div class="title">${u.url}</div>
        <div class="row-badges">${badge(u.badges.a11y)}${badge(u.badges.perf)}${badge(u.badges.sec)}${badge(u.badges.seo)}${badge(u.badges.visual)}${badge(u.badges.ux)}${badge(u.badges.stability)}</div>
      </button>`;
    }).join('')}</div>`;
    container.querySelectorAll('.url-row').forEach((el)=>el.onclick=()=>{const operationId=createOperationId(); state.selectedId=el.dataset.id; state.selectedDomain=null; state.selectedView='url'; if(window.location.hash==='#/domain-overview'){ window.location.hash=tabToHash(state.selectedTab); } logEvent('INFO','UI URL selection changed',{operationId,urlId:state.selectedId,view:state.selectedTab}); render();});
  };
  container.onscroll = renderRows;
  renderRows();
}

function renderDetailsShell(u){
  const a11y = u.sections['accessibility.json']?.summary || {};
  const sec = u.sections['security-scan.json']?.summary?.missingHeaders ?? MISSING;
  const broken = u.sections['broken-links.json']?.summary?.brokenCount ?? MISSING;
  const visual = u.sections['visual-regression.json']?.summary?.passed;
  const urlHeading = renderDomainLink(u.url, { fallback: escapeHtml(u.url) }) ?? escapeHtml(u.url);
  return `<header class="detail-header">
    <h2>${urlHeading}</h2>
    <div class="meta">Data path: ${escapeHtml(formatUrlDataPath(u))}</div>
    <div class="top-issues">
      <span>A11y C/S: ${a11y.critical??0}/${a11y.serious??0}</span>
      <span>Missing security headers: ${sec}</span>
      <span>Broken links: ${broken}</span>
      <span>Visual: ${visual===undefined?MISSING:visual?'Pass':'Fail'}</span>
    </div>
  </header>
  <nav class="tabs" aria-label="Dashboard navigation">${renderSectionTabs()}</nav>
  <section id="tab-content" class="tab-content"><p>Loading ${state.selectedTab}…</p></section>
  <section class="parse-errors">${(state.index.parseErrors||[]).slice(-10).map((e)=>`<div>⚠ ${e.file}: ${e.message}</div>`).join('') || ''}</section>`;
}



function renderSectionTabs(){
  const activeCategory = selectedCategory();
  const categories = state.sections.categories.map((category)=>`<button class="tab group-tab ${activeCategory?.id===category.id?'active':''}" data-group="${category.id}" role="tab" aria-selected="${activeCategory?.id===category.id?'true':'false'}">${category.label}</button>`).join('');
  const sections = (activeCategory?.sections ?? []).map((section)=>{
    const label = state.sections.definitions[section].label;
    return `<button class="tab subgroup-tab ${state.selectedTab===section?'active':''}" data-tab="${section}" role="tab" aria-selected="${state.selectedTab===section?'true':'false'}">${label}</button>`;
  }).join('');
  return `<div class="tabs-sticky"><div class="tab-row groups-row" role="tablist" aria-label="Categories">${categories}</div><div class="tab-row subgroups-row" role="tablist" aria-label="Sections">${sections}</div></div>`;
}

function bindFilters(){
  document.getElementById('search').oninput=(e)=>{const operationId=createOperationId(); state.search=e.target.value; logEvent('INFO','UI search changed',{operationId,view:'filters',search:summarizeInput(state.search)}); render({ preserveSearchFocus: true });};
  document.getElementById('regex').onchange=(e)=>{const operationId=createOperationId(); state.regex=e.target.checked; logEvent('INFO','UI regex toggle changed',{operationId,view:'filters',enabled:state.regex}); render();};
  document.getElementById('f-fail').onchange=(e)=>{state.facets.failures=e.target.checked; logEvent('INFO','UI facet changed',{operationId:createOperationId(),facet:'failures',enabled:state.facets.failures}); render();};
  document.getElementById('f-broken').onchange=(e)=>{state.facets.broken=e.target.checked; logEvent('INFO','UI facet changed',{operationId:createOperationId(),facet:'broken',enabled:state.facets.broken}); render();};
  document.getElementById('f-visual').onchange=(e)=>{state.facets.visualFailed=e.target.checked; logEvent('INFO','UI facet changed',{operationId:createOperationId(),facet:'visualFailed',enabled:state.facets.visualFailed}); render();};
  document.getElementById('f-throttle').onchange=(e)=>{state.facets.throttled=e.target.checked; logEvent('INFO','UI facet changed',{operationId:createOperationId(),facet:'throttled',enabled:state.facets.throttled}); render();};
  document.querySelectorAll('[data-sev]').forEach((btn)=>btn.onclick=()=>{const sev=btn.dataset.sev; state.facets.a11y.has(sev)?state.facets.a11y.delete(sev):state.facets.a11y.add(sev); logEvent('INFO','UI a11y severity filter changed',{operationId:createOperationId(),severity:sev,enabled:state.facets.a11y.has(sev)}); render();});

  const verboseBtn = document.getElementById('toggle-verbose');
  if(verboseBtn) verboseBtn.onclick = async ()=>{
    await fetch('/api/log-level',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({level:'DEBUG'})});
    logEvent('INFO','UI verbose logging enabled',{operationId:createOperationId()});
  };

  const diagBtn = document.getElementById('export-diagnostics');
  if(diagBtn) diagBtn.onclick = async ()=>{
    const operationId=createOperationId();
    logEvent('INFO','UI export diagnostics requested',{operationId});
    const res = await fetch('/api/diagnostics/export',{method:'POST'});
    const body = await res.json();
    alert(`Diagnostics exported: ${body.file}`);
    logEvent('INFO','UI export diagnostics completed',{operationId,filePath:body.file});
  };

  const themeToggle = document.getElementById('theme-toggle');
  if(themeToggle) {
    themeToggle.onclick = ()=>{
      state.theme = toggleTheme(state.theme);
      logEvent('INFO','UI theme changed',{operationId:createOperationId(),theme:state.theme});
      render();
    };
    themeToggle.onkeydown = (event)=>{
      if(event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        themeToggle.click();
      }
    };
  }
}

function bindTabEvents(u){
  document.querySelectorAll('[data-group]').forEach((button)=>button.onclick=()=>{
    const group = state.sections.categories.find((category)=>category.id===button.dataset.group);
    if(!group || !group.sections.length) return;
    const nextTab = group.sections.includes(state.selectedTab) ? state.selectedTab : group.sections[0];
    const operationId=createOperationId();
    state.selectedDomain=null;
    state.selectedView='url';
    setSelectedTab(nextTab);
    logEvent('INFO','UI group changed',{operationId,urlId:u.id,group:group.id,section:nextTab,view:nextTab});
    render();
  });
  document.querySelectorAll('[data-tab]').forEach((button)=>button.onclick=()=>{
    const operationId=createOperationId();
    state.selectedDomain=null;
    state.selectedView='url';
    setSelectedTab(button.dataset.tab);
    logEvent('INFO','UI tab changed',{operationId,urlId:u.id,section:state.selectedTab,view:state.selectedTab});
    render();
  });
  loadTab(u.id,state.selectedTab);
}

function renderStateBox(stateName, reason=''){
  if(stateName==='missing') return `<div class="state missing">Missing / not executed</div>`;
  if(stateName==='not_available') return `<div class="state na">${MISSING}${reason?`: ${reason}`:''}</div>`;
  if(stateName==='error') return `<div class="state error">Malformed JSON</div>`;
  return '';
}

function renderKeyTerms(tab){
  const definition = state.sections?.definitions?.[tab];
  const glossary = state.sections?.glossary ?? {};
  const keys = definition?.info?.keyTerms ?? [];
  if(!keys.length) return '<p class="muted-copy">No key terms in this view.</p>';
  const seen = new Set();
  const items = keys.filter((key)=>{ if(seen.has(key)) return false; seen.add(key); return true; }).map((key)=>{
    const term = glossary[key];
    if(!term) return '';
    const termLabel = term.expanded ? `${term.label} (${term.expanded})` : term.label;
    return `<div class="definition-item"><dt>${escapeHtml(termLabel)} — ${escapeHtml(term.meaning)}</dt><dd><strong>Why it matters:</strong> ${escapeHtml(term.whyItMatters)}</dd></div>`;
  }).join('');
  return `<dl class="definition-list">${items}</dl>`;
}

function collapsiblePanel(id, label, content){
  return `<section class="collapsible-panel"><button type="button" class="collapsible-trigger" data-collapse-target="${id}" aria-expanded="false">${label}</button><div id="${id}" class="collapsible-content" hidden>${content}</div></section>`;
}

function bindCollapsiblePanels(scope){
  scope.querySelectorAll('[data-collapse-target]').forEach((button)=>{
    button.onclick=()=>{
      const target = scope.querySelector(`#${button.dataset.collapseTarget}`);
      if(!target) return;
      const expanded = button.getAttribute('aria-expanded') === 'true';
      button.setAttribute('aria-expanded', expanded ? 'false' : 'true');
      target.hidden = expanded;
    };
  });
}

function rawPanel(raw, section){
  const panelId = `raw-${section.replace(/[^a-z0-9_-]/gi,'-')}`;
  return collapsiblePanel(panelId, 'Raw JSON', `<pre>${raw?JSON.stringify(raw,null,2):MISSING}</pre>`);
}

function escapeHtml(v){
  return String(v ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
}

function explanationPanel(tab){
  const definition = state.sections?.definitions?.[tab];
  if(!definition?.info) return '';
  const panelId = `explanation-${tab.replace(/[^a-z0-9_-]/gi,'-')}`;
  const info = definition.info;
  const content = `<div class="explanation-body"><table class="explanation-table"><tbody><tr><th>What it is</th><td>${escapeHtml(info.whatItIs)}</td></tr><tr><th>Why it matters</th><td>${escapeHtml(info.whyItMatters)}</td></tr><tr><th>How to read</th><td><ul>${info.howToRead.map((item)=>`<li>${escapeHtml(item)}</li>`).join('')}</ul></td></tr><tr><th>Key terms in this view</th><td>${renderKeyTerms(tab)}</td></tr></tbody></table></div>`;
  return collapsiblePanel(panelId, 'Explanation', content);
}

function normalizeDisplay(value){
  if(value === null || value === undefined || value === '') return MISSING;
  if(typeof value === 'string'){
    if(value.toLowerCase() === 'null') return MISSING;
    if(value === 'not measured') return value;
    return value;
  }
  if(typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

function fmt(value, unit=''){ const n = toNum(value); if(n===null) return (value === 'not measured' ? 'not measured' : MISSING); const rounded = Number.isInteger(n) ? n : Number(n.toFixed(2)); return `${rounded}${unit ? ` ${unit}` : ''}`; }
function metric(label, value, unit=''){ return `<div class="kpi"><span>${label}</span><strong>${fmt(value, unit)}</strong></div>`; }
function textMetric(label, value){ return `<div class="kpi"><span>${label}</span><strong>${escapeHtml(normalizeDisplay(value))}</strong></div>`; }
function severityRank(value){ const ranks = { low:1, medium:2, high:3, critical:4 }; return ranks[String(value).toLowerCase()] ?? 0; }
function sortRows(rows, sort){ const dir = sort.dir === 'asc' ? 1 : -1; return [...rows].sort((a,b)=>{ const av=a[sort.key]; const bv=b[sort.key]; if(sort.key==='severity') return (severityRank(av)-severityRank(bv))*dir; const an=toNum(av); const bn=toNum(bv); if(an!==null&&bn!==null) return (an-bn)*dir; return String(av??'').localeCompare(String(bv??''))*dir;}); }
function sortableHeader(label, scope, key){ const s=state.sorts[scope]; const arrow=s.key===key?(s.dir==='asc'?'↑':'↓'):''; return `<th><button class="sort-btn" data-sort-scope="${scope}" data-sort-key="${key}">${label} ${arrow}</button></th>`; }

function unwrapArtifact(raw){
  if(raw && typeof raw === 'object' && !Array.isArray(raw) && 'payload' in raw){
    return { payload: raw.payload, meta: raw.meta && typeof raw.meta === 'object' ? raw.meta : {} };
  }
  return { payload: raw, meta: {} };
}

async function loadTab(id, tab){
  const operationId=createOperationId();
  const started=performance.now();
  logEvent('INFO','UI section navigation',{operationId,urlId:id,section:tab,view:tab});
  const el = document.getElementById('tab-content');
  const res = await fetch(`/api/url/${encodeURIComponent(id)}/section/${encodeURIComponent(tab)}`);
  const payload = await res.json();
  const head = renderStateBox(payload.state,payload.summary?.reason);
  let body = '';
  const raw = payload.raw;
  const unwrapped = unwrapArtifact(raw);
  const selected = state.index?.urls?.find((entry)=>entry.id===id) ?? {};

  switch(tab){
    case 'a11y-beyond-axe.json': body = renderA11yHeuristics(unwrapped.payload); break;
    case 'accessibility.json': body = renderAxe(unwrapped.payload); break;
    case 'broken-links.json': body = renderBroken(unwrapped.payload, { artifactMissing: payload.state === 'missing', runId: state.selectedId }); break;
    case 'core-web-vitals.json': body = renderCwv(unwrapped.payload); break;
    case 'memory-profile.json': body = renderMemory(unwrapped.payload); break;
    case 'performance.json': body = renderPerformance(unwrapped.payload); break;
    case 'cross-browser-performance.json': body = renderCrossBrowserPerformance(unwrapped.payload); break;
    case 'security-scan.json': body = renderSecurity(unwrapped.payload); break;
    case 'seo-score.json': body = renderSeoScore(unwrapped.payload); break;
    case 'stability.json': body = renderStability(unwrapped.payload); break;
    case 'target-summary.json': body = renderTarget(unwrapped.payload, unwrapped.meta, selected); break;
    case 'third-party-risk.json': body = renderThirdParty(unwrapped.payload); break;
    case 'throttled-run.json': body = renderThrottled(unwrapped.payload); break;
    case 'visual-current.png': body = payload.summary?.image ? `<div class="image-wrap"><img src="${payload.summary.image}"></div>` : `<p>${MISSING}</p>`; break;
    case 'visual-regression.json': body = renderVisualReg(unwrapped.payload); break;
    case 'client-errors.json': body = renderClientErrors(unwrapped.payload); break;
    case 'ux-overview.json': body = renderUxOverview(unwrapped.payload, selected); break;
    case 'ux-sanity.json':
    case 'ux-layout-stability.json':
    case 'ux-interaction.json':
    case 'ux-click-friction.json':
    case 'ux-keyboard.json':
    case 'ux-overlays.json':
    case 'ux-readability.json':
    case 'ux-forms.json':
    case 'ux-visual-regression.json': body = renderUxGeneric(tab, unwrapped.payload, selected); break;
    case 'memory-leaks.json': body = renderMemoryLeaks(unwrapped.payload); break;
    case 'privacy-audit.json': body = renderPrivacyAudit(unwrapped.payload); break;
    case 'runtime-security.json': body = renderRuntimeSecurity(unwrapped.payload); break;
    case 'dependency-risk.json': body = renderDependencyRisk(unwrapped.payload); break;
    case 'regression-summary.json': body = renderRegressionSummary(unwrapped.payload, selected); break;
    default: body = '<p>Unsupported section</p>';
  }
  el.innerHTML = `${explanationPanel(tab)}${head}${body}${rawPanel(raw, tab)}`;
  bindCollapsiblePanels(el);
  if(tab === 'a11y-beyond-axe.json') bindA11yHeuristics(el);
  if(tab === 'broken-links.json') bindBrokenLinks(el);
  if(tab === 'security-scan.json') bindSecurity(el);
  if(tab.startsWith('ux-')) bindUxIssueVisualizations(el);
  logEvent(Math.round(performance.now()-started)>500?'WARN':'INFO','UI section render completed',{operationId,urlId:id,section:tab,view:tab,durationMs:Math.round(performance.now()-started),state:payload.state});

  el.querySelectorAll('[data-sort-scope]').forEach((btn)=>btn.onclick=()=>{const scope=btn.dataset.sortScope;const key=btn.dataset.sortKey;const current=state.sorts[scope];state.sorts[scope]={key,dir:current.key===key&&current.dir==='asc'?'desc':'asc'};loadTab(id, tab);});
}


async function openUxIssueVisualization(scope, trigger){
  const modal = scope.querySelector('.ux-issue-modal');
  if(!modal) return;
  const screenshotPath = decodeURIComponent(trigger.dataset.screenshotPath || '');
  const metaPath = decodeURIComponent(trigger.dataset.metaPath || '');
  if(!screenshotPath || !metaPath) return;
  const res = await fetch(`/artifacts/${encodeURIComponent(state.selectedId)}/${metaPath}`);
  if(!res.ok){
    modal.querySelector('.ux-issue-modal-body').innerHTML = `<p>Unable to load visualization metadata.</p>`;
    modal.showModal();
    return;
  }
  const meta = await res.json();
  const selectors = Array.isArray(meta.selectors) ? meta.selectors : [];
  const selectorItems = selectors.map((selector)=>{
    const matches = Array.isArray(selector.matches) ? selector.matches : [];
    const matchRows = matches.length
      ? `<ul>${matches.map((match)=>`<li><button type="button" class="link" data-highlight-label="${escapeHtml(match.label)}">${escapeHtml(match.label)}</button> · <code>${escapeHtml(match.tagName)}</code> ${escapeHtml(match.id ? `#${match.id}` : '')} ${escapeHtml(match.className ? `.${match.className.split(/\s+/).join('.')}` : '')} — ${escapeHtml(match.textSnippet || 'No text')}</li>`).join('')}</ul>`
      : '<p class="muted-copy">0 matches</p>';
    return `<article class="ux-issue-selector"><h4><code>${escapeHtml(selector.selector || '')}</code> <span class="muted-copy">(${selector.matchCount || 0} matches${selector.unresolvedFrame ? ', unresolved frame' : ''})</span></h4>${matchRows}</article>`;
  }).join('');

  const image = `/artifacts/${encodeURIComponent(state.selectedId)}/${encodeURIComponent(screenshotPath)}`;
  const title = decodeURIComponent(trigger.dataset.issueTitle || 'Issue visualization');
  modal.querySelector('.ux-issue-modal-body').innerHTML = `<h3>${escapeHtml(title)}</h3><div class="ux-issue-viewer"><img class="ux-issue-image" src="${image}" alt="Annotated issue screenshot"></div><div class="ux-issue-selectors">${selectorItems || '<p>No selectors metadata available.</p>'}</div>`;
  modal.querySelectorAll('[data-highlight-label]').forEach((btn)=>{
    btn.onclick = ()=>{
      const label = btn.dataset.highlightLabel;
      const imageEl = modal.querySelector('.ux-issue-image');
      if(imageEl) imageEl.setAttribute('data-focus-label', label || '');
    };
  });
  modal.showModal();
}

function bindUxIssueVisualizations(scope){
  const modal = scope.querySelector('.ux-issue-modal');
  if(!modal) return;
  scope.querySelectorAll('.issue-visualization-btn').forEach((button)=>{
    button.onclick = ()=>openUxIssueVisualization(scope, button);
  });
}

const renderA11yHeuristics = (r={})=>{
  const simulation = r.contrastSimulationResult || {};
  const score = toNum(simulation.score ?? r.contrastSimulationScore);
  const reason = safe(simulation.reasonMessage || r.contrastSimulationScoreReason, '');
  const reasonCode = safe(simulation.reasonCode, '');
  const scoreValue = score === null ? MISSING : score;
  const candidates = r.possibleFocusTrapDetails?.candidates || [];
  const findings = r.contrastSimulationDetails?.findings || [];
  const worstSamples = Array.isArray(simulation.samples) ? simulation.samples.slice(0, 5) : [];
  state.a11yContrastFindings = findings;
  const method = r.contrastSimulationDetails?.method;
  const focusStatus = r.possibleFocusTrap ? 'Possible trap detected' : 'No trap detected';
  const focusCards = r.possibleFocusTrap && candidates.length ? `<div class="cards">${candidates.map((candidate)=>{
    const shot = candidate.evidence?.screenshotPath;
    const thumb = shot ? `<img class="a11y-thumb" src="/artifacts/${encodeURIComponent(state.selectedId)}/${encodeURIComponent(shot)}" alt="Focus trap evidence">` : '';
    return `<article>${thumb}<p><strong>${escapeHtml(candidate.trapCandidate?.selector || 'Unknown selector')}</strong></p><p>${escapeHtml(candidate.evidence?.repeatPatternDetected || '')}</p><p>${escapeHtml(candidate.reproSteps || '')}</p></article>`;
  }).join('')}</div>` : `<p>${escapeHtml(focusStatus)}</p>`;
  const methodPanel = method ? `<details><summary>How this score is calculated</summary><pre>${escapeHtml(JSON.stringify(method,null,2))}</pre></details>` : '';
  const thumbs = findings.length ? `<div class="a11y-thumb-grid">${findings.map((sample, index)=>`<button class="a11y-thumb-button" data-contrast-sample-index="${index}"><img class="a11y-thumb" src="/artifacts/${encodeURIComponent(state.selectedId)}/${encodeURIComponent(sample.thumbnailId ? `a11y-beyond-axe/${sample.thumbnailId}` : sample.screenshotPath)}" alt="Contrast sample ${index + 1}"><span>scrollY ${safe(sample.scrollY,0)}</span></button>`).join('')}</div>` : '<p>No contrast samples available.</p>';
  const worstList = worstSamples.length ? `<details open><summary>Most influential low-contrast samples</summary><table><tr><th>Selector</th><th>Ratio</th><th>Score</th><th>Foreground</th><th>Background</th></tr>${worstSamples.map((sample)=>`<tr><td>${safe(sample.selector)}</td><td>${safe(sample.contrastRatio)}</td><td>${safe(sample.regionScore)}</td><td>${safe(sample.foregroundColor)}</td><td>${safe(sample.backgroundColor)}</td></tr>`).join('')}</table></details>` : '';
  const statusLine = simulation.status === 'not_available' && reason ? `<p>contrastSimulationScore unavailable (${escapeHtml(reasonCode || 'unknown')}): ${escapeHtml(reason)}</p>` : '';
  return `<div class="kpis">${textMetric('keyboardReachable',r.keyboardReachable)}${textMetric('possibleFocusTrap',r.possibleFocusTrap)}${textMetric('contrastSimulationScore',scoreValue)}</div>${statusLine}<h4>possibleFocusTrap</h4>${focusCards}<h4>contrastSimulationScore</h4>${methodPanel}${worstList}${thumbs}<dialog class="a11y-modal"><form method="dialog"><button class="link">Close</button></form><div class="a11y-modal-body"></div></dialog>`;
};

function bindA11yHeuristics(scope){
  const modal = scope.querySelector('.a11y-modal');
  if(!modal) return;
  scope.querySelectorAll('[data-contrast-sample-index]').forEach((button)=>button.onclick=()=>{
    const index = Number(button.dataset.contrastSampleIndex);
    const sample = state.a11yContrastFindings[index];
    if(!sample) return;
    const regions = Array.isArray(sample.measuredRegions) ? sample.measuredRegions : [];
    const overlays = regions.map((region)=>`<div class="a11y-overlay" style="left:${region.boundingBox?.x || 0}px;top:${region.boundingBox?.y || 0}px;width:${region.boundingBox?.width || 0}px;height:${region.boundingBox?.height || 0}px;" title="${escapeHtml(region.why || '')}"></div>`).join('');
    const rows = regions.map((region)=>`<tr><td>${safe(region.selector)}</td><td>${safe(region.regionScore)}</td><td>${safe(region.contrastRatio)}</td><td>${safe(region.why)}</td></tr>`).join('');
    const recs = (sample.recommendations || []).map((rec)=>`<li>${escapeHtml(rec)}</li>`).join('');
    modal.querySelector('.a11y-modal-body').innerHTML = `<label><input type="checkbox" checked data-toggle-overlays> Show overlays</label><div class="a11y-shot-wrap"><img class="a11y-full" src="/artifacts/${encodeURIComponent(state.selectedId)}/${encodeURIComponent(sample.screenshotPath)}" alt="contrast sample"><div class="a11y-overlays">${overlays}</div></div><table><tr><th>Selector</th><th>Region score</th><th>Contrast ratio</th><th>Explanation</th></tr>${rows}</table><ul>${recs}</ul>`;
    const toggle = modal.querySelector('[data-toggle-overlays]');
    if(toggle) toggle.onchange = ()=>{ const layer = modal.querySelector('.a11y-overlays'); if(layer) layer.style.display = toggle.checked ? 'block' : 'none'; };
    modal.showModal();
  });
}

const renderAxe = (r={})=>{ const issues=r.issues||[]; return `<div class="kpis">${['critical','serious','moderate','minor'].map(s=>metric(s,r.counters?.[s]??r[s]??0)).join('')}</div><table><tr><th>Rule</th><th>Impact</th><th>Description</th><th>Nodes</th></tr>${issues.slice(0,200).map(i=>`<tr><td>${safe(i.id)}</td><td>${safe(i.impact)}</td><td>${safe(i.description)}</td><td>${safe(i.nodes?.length ?? i.nodes)}</td></tr>`).join('')}</table>`; };
const renderCwv = (r={})=>{const vals=[toNum(r.lcpMs ?? r.lcp),toNum(r.cls),toNum(r.inpMs ?? r.inp),toNum(r.fcpMs ?? r.fcp)]; const ready=Math.round(vals.filter((v)=>v!==null).length/4*100); return `<div class="kpis">${metric('LCP',r.lcpMs ?? r.lcp,'ms','Largest Contentful Paint')}${metric('CLS',r.cls)}${metric('INP',r.inpMs ?? r.inp,'ms','Interaction to Next Paint')}${metric('FCP',r.fcpMs ?? r.fcp,'ms','First Contentful Paint')}${metric('Readiness',ready,'%')}</div>`};
const renderMemory = (r={})=>`<div>${metric('Growth',r.growth ?? r.growthVerdict,'bytes')}<pre>${(r.samples||[]).slice(0,20).map((x)=>Math.round(x)).join(', ')}</pre></div>`;
const renderPerformance = (r={})=>{const n=r.navigation||{}; const breakdown=fcpAttemptBreakdown(r.fcpAttempts, r.fcpReportedMs ?? r.paint?.fcpMs ?? r.paint?.['first-contentful-paint']); return `<div class="kpis">${metric('DNS',n.dnsMs,'ms')}${metric('TCP',n.tcpMs,'ms')}${metric('TTFB',n.ttfbMs,'ms')}${metric('DCL',n.domContentLoadedMs,'ms')}${metric('Load',n.loadEventMs,'ms')}${metric('FP',r.paint?.fpMs ?? r.paint?.['first-paint'],'ms')}${metric('FCP',r.fcpReportedMs ?? r.paint?.fcpMs ?? r.paint?.['first-contentful-paint'],'ms')}</div>${breakdown?`<p class="secondary">${breakdown}</p><p class="secondary">${safe(r.fcpDecisionReason ?? '')}</p>`:''}`;};
const renderCrossBrowserPerformance = (r={})=>{
  const data = r.crossBrowserPerformance || {};
  const reasonLabels = {
    disabled: 'Disabled via config/features.json',
    missing_config: 'Config file missing (defaults to untested)',
    invalid_config: 'Invalid config file/schema',
    skipped_headless: 'Skipped because run is headless',
    no_browsers_configured: 'No browsers configured'
  };

  if(data.status === 'untested'){
    const reason = reasonLabels[data.reason] || safe(data.reason, 'Not configured');
    return `<div class="state na">Untested: ${escapeHtml(String(reason))}</div>`;
  }

  const results = Array.isArray(data.results) ? data.results : [];
  const fastest = results.length ? results.reduce((best, row) => (toNum(row.avgLoadMs) ?? Number.POSITIVE_INFINITY) < (toNum(best.avgLoadMs) ?? Number.POSITIVE_INFINITY) ? row : best) : null;
  const slowest = results.length ? results.reduce((worst, row) => (toNum(row.avgLoadMs) ?? Number.NEGATIVE_INFINITY) > (toNum(worst.avgLoadMs) ?? Number.NEGATIVE_INFINITY) ? row : worst) : null;
  const diff = fastest && slowest ? (toNum(slowest.avgLoadMs) ?? 0) - (toNum(fastest.avgLoadMs) ?? 0) : null;
  const summary = results.map((row)=>`<tr class="${fastest?.browser===row.browser?'row-fastest':''} ${slowest?.browser===row.browser?'row-slowest':''}"><td>${safe(row.browser)}</td><td>${fmt(row.avgLoadMs,'ms')}</td><td>${fmt(row.minLoadMs,'ms')}</td><td>${fmt(row.maxLoadMs,'ms')}</td><td>${fmt(row.samples)}</td></tr>`).join('');
  return `<div class="kpis">${textMetric('Status',data.status ?? MISSING)}${textMetric('Fastest',fastest?.browser ?? MISSING)}${textMetric('Slowest',slowest?.browser ?? MISSING)}${metric('Slowest vs fastest',diff,'ms')}</div><table><tr><th>Browser</th><th>Avg</th><th>Min</th><th>Max</th><th>Samples</th></tr>${summary}</table>`;
};
function toSecurityV2(r={}){
  if(r && r.summary && r.headers) return r;
  const missingHeaders = Array.isArray(r.missingHeaders) ? r.missingHeaders : [];
  const headerMap = {
    csp: 'content-security-policy', hsts: 'strict-transport-security', xFrameOptions: 'x-frame-options', referrerPolicy: 'referrer-policy', xContentTypeOptions: 'x-content-type-options', permissionsPolicy: 'permissions-policy', coop: 'cross-origin-opener-policy', coep: 'cross-origin-embedder-policy', corp: 'cross-origin-resource-policy', cspReportOnly: 'content-security-policy-report-only'
  };
  const headers = Object.fromEntries(Object.entries(headerMap).map(([k,v])=>[k,{present: !missingHeaders.includes(v), rawValue: null, status: missingHeaders.includes(v)?'missing':'pass', severity: missingHeaders.includes(v)?'medium':'info', message: missingHeaders.includes(v)?`${v} missing`:`${v} present`, findings: []}]));
  return {
    summary: { overallStatus: missingHeaders.length ? 'warning' : 'pass', severityCounts: { high:0, medium:missingHeaders.length, low:0, info:0 }, topFindings: [] },
    headers,
    hstsAnalysis: { directives:{}, findings:[] },
    cspAnalysis: { directives:{}, findings:[] },
    httpsEnforcement: { httpToHttps: { passed: String(r.tlsVersion||'').includes('TLS'), chain: [], finalUrl: '', status: 0 }, tls: { scheme: String(r.tlsVersion||'').includes('TLS') ? 'https':'http', protocol: null, cipher: null } },
    mixedContent: { hasMixedContent: Boolean(r.mixedContent), items: [], counts: { active:0, passive:0 } },
    httpLinksOnHttpsPage: { items: [], count: 0 },
    insecureFormActions: { items: [], count: 0 },
    cookies: { items: [], findings: [], counts: { total:0, missingSecure:0, missingHttpOnly:0, sameSiteNoneWithoutSecure:0 } },
    thirdParty: { scriptOrigins: [], missingSRI: [], counts: { origins:0, scripts:0, missingSri:0 } }
  };
}

const renderSecurity = (input={})=>{
  const r = toSecurityV2(input);
  const findings = (r.summary?.topFindings || []).map((f)=>({ ...f, detail: (r.cookies?.findings||[]).concat(r.cspAnalysis?.findings||[], r.hstsAnalysis?.findings||[]).find((x)=>x.id===f.id) || null }));
  const headerRows = Object.entries(r.headers || {}).map(([name, info])=>`<tr><td>${safe(name)}</td><td>${safe(info.status)}</td><td>${safe(info.severity)}</td><td>${safe((info.rawValue||'').slice(0,80) || '—')}</td><td><details><summary>Details</summary><pre>${escapeHtml(JSON.stringify(info, null, 2))}</pre></details></td></tr>`).join('');
  const findingRows = findings.map((item)=>`<details class="sec-finding" data-severity="${safe(item.severity)}"><summary><strong>${safe(item.title)}</strong> · ${safe(item.severity)}</summary><p>${safe(item.message)}</p>${item.detail?`<pre>${escapeHtml(JSON.stringify(item.detail.evidence || {}, null, 2))}</pre>`:''}</details>`).join('') || '<p>No findings.</p>';
  const mixedRows = (r.mixedContent?.items||[]).map((item)=>`<tr><td>${safe(item.classification)}</td><td>${safe(item.resourceType)}</td><td>${safe(item.url)}</td><td>${safe(item.initiator)}</td></tr>`).join('');
  const httpLinkRows = (r.httpLinksOnHttpsPage?.items||[]).map((item)=>`<tr><td>${safe(item.linkText)}</td><td>${safe(item.href)}</td><td>${safe(item.domPath)}</td></tr>`).join('');
  const formRows = (r.insecureFormActions?.items||[]).map((item)=>`<tr><td>${safe(item.method)}</td><td>${safe(item.action)}</td><td>${safe(item.domPath)}</td></tr>`).join('');
  const cookieRows = (r.cookies?.items||[]).map((item)=>`<tr><td>${safe(item.name)}</td><td>${item.secure?'Yes':'No'}</td><td>${item.httpOnly?'Yes':'No'}</td><td>${safe(item.sameSite||'')}</td><td>${safe(item.raw)}</td></tr>`).join('');
  const sriRows = (r.thirdParty?.missingSRI||[]).map((item)=>`<tr><td>${safe(item.scriptUrl)}</td><td>${safe(item.selector)}</td></tr>`).join('');
  return `<div class="kpis">${textMetric('Overall status', r.summary?.overallStatus)}${metric('High', r.summary?.severityCounts?.high)}${metric('Medium', r.summary?.severityCounts?.medium)}${metric('Low', r.summary?.severityCounts?.low)}${metric('Info', r.summary?.severityCounts?.info)}</div>
  <div class="kpis">${textMetric('HTTPS enforced', r.httpsEnforcement?.httpToHttps?.passed ? 'Yes':'No')}${textMetric('TLS protocol', r.httpsEnforcement?.tls?.protocol || 'not available')}${textMetric('Mixed content', `${safe(r.mixedContent?.counts?.active,0)}/${safe(r.mixedContent?.counts?.passive,0)}`)}${metric('Missing/weak headers', Object.values(r.headers||{}).filter((h)=>h.status==='missing'||h.status==='weak').length)}</div>
  <div class="panel"><h4>Top findings</h4><label>Severity <select data-security-filter-severity><option value="all">all</option><option value="high">high</option><option value="medium">medium</option><option value="low">low</option><option value="info">info</option></select></label> <label>Search evidence <input data-security-search placeholder="url contains"></label><div data-security-findings>${findingRows}</div></div>
  <details><summary>Headers</summary><table><tr><th>Header</th><th>Status</th><th>Severity</th><th>Value</th><th>Details</th></tr>${headerRows}</table></details>
  <details><summary>HTTPS enforcement</summary><pre>${escapeHtml(JSON.stringify(r.httpsEnforcement, null, 2))}</pre></details>
  <details><summary>Mixed content (${safe(r.mixedContent?.items?.length,0)})</summary><table><tr><th>Class</th><th>Type</th><th>URL</th><th>Initiator</th></tr>${mixedRows}</table></details>
  <details><summary>Links to HTTP (${safe(r.httpLinksOnHttpsPage?.count,0)})</summary><table><tr><th>Text</th><th>Href</th><th>Selector</th></tr>${httpLinkRows}</table></details>
  <details><summary>Forms posting to HTTP (${safe(r.insecureFormActions?.count,0)})</summary><table><tr><th>Method</th><th>Action</th><th>Selector</th></tr>${formRows}</table></details>
  <details><summary>Cookies (${safe(r.cookies?.counts?.total,0)})</summary><table><tr><th>Name</th><th>Secure</th><th>HttpOnly</th><th>SameSite</th><th>Raw</th></tr>${cookieRows}</table></details>
  <details><summary>Third-party scripts & SRI</summary><p><a href="#" data-nav-tab="third-party-risk.json">Open third-party-risk</a></p><table><tr><th>Script URL</th><th>Selector</th></tr>${sriRows}</table></details>`;
};

function bindSecurity(scope){
  const severity = scope.querySelector('[data-security-filter-severity]');
  const search = scope.querySelector('[data-security-search]');
  const apply = ()=>{
    const sev = severity?.value || 'all';
    const q = (search?.value || '').toLowerCase();
    scope.querySelectorAll('.sec-finding').forEach((item)=>{
      const text = item.textContent.toLowerCase();
      const matchesSev = sev === 'all' || item.dataset.severity === sev;
      const matchesQ = !q || text.includes(q);
      item.style.display = matchesSev && matchesQ ? '' : 'none';
    });
  };
  severity?.addEventListener('change', apply);
  search?.addEventListener('input', apply);
}

const seoBand = (score)=>{
  const n = toNum(score);
  if(n===null) return 'Not measured';
  if(n>=90) return 'Excellent';
  if(n>=75) return 'Good';
  if(n>=55) return 'Needs work';
  return 'Poor';
};
const checkBadge = (status)=>`<span class="chip chip-${safe(status)}">${safe(status)}</span>`;
const renderSeoScore = (r={})=>{
  const overall = toNum(r.overallScore);
  if(overall===null) return '<div class="state na">SEO score not measured</div>';
  const subs = r.subscores || {};
  const categories = ['indexability','onPage','content','performanceProxy'];
  const categoryCards = categories.map((key)=>`<div class="kpi"><span>${safe(key)}</span><strong>${fmt(subs[key]?.score)}</strong></div>`).join('');
  const checks = Array.isArray(r.checks) ? r.checks : [];
  return `<div class="kpis">${metric('Overall SEO score', overall)}${textMetric('Band', seoBand(overall))}</div><div class="kpis">${categoryCards}</div><details open><summary>Checks</summary><table><tr><th>Check</th><th>Status</th><th>Points</th><th>Recommendation</th></tr>${checks.map((c)=>`<tr><td>${safe(c.label)}</td><td>${checkBadge(c.status)}</td><td>${safe(c.points)}/${safe(c.maxPoints)}</td><td>${safe(c.recommendation)}</td></tr>`).join('')}</table></details>`;
};
const renderStability = (r={})=>{const samples=buildStabilityRows(r.loadEventSamples||[],r.timestamps,STABILITY_SLOW_ABSOLUTE_MS,STABILITY_SLOW_RELATIVE_MULTIPLIER); const sorted=sortRows(samples,state.sorts.stability); return `<div class="kpis">${metric('Iterations',r.iterations)}${metric('Std Dev',r.stdDev ?? r.stdDevLoadMs,'ms')}${metric('CV',r.coefficientOfVariation)}${textMetric('Unstable',r.unstable?'Yes':'No')}</div><table><tr>${sortableHeader('#','stability','index')}${sortableHeader('Load event','stability','sample')}${sortableHeader('Timestamp','stability','timestamp')}</tr>${sorted.slice(0,300).map(x=>`<tr class="${x.rowClass}"><td>${x.index}</td><td>${fmt(x.sample,'ms')}</td><td>${x.timestamp}</td></tr>`).join('')}</table>`;};
const resolveOverallScore = (r={}) => {
  const explicit = toNum(r.overallScore ?? r.score);
  if (explicit !== null) return explicit;
  const enterprise = r.enterpriseScore;
  if (enterprise && typeof enterprise === 'object' && !Array.isArray(enterprise)) {
    const values = Object.values(enterprise).map((value) => toNum(value)).filter((value) => value !== null);
    if (values.length > 0) return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
  }
  return null;
};

const renderTarget = (r={}, m={}, indexMeta={})=>`<div class="kpis">${textMetric('URL',r.url ?? r.target?.url ?? m.url)}${textMetric('Run ID',r.runId ?? m.runId ?? indexMeta.runId)}${textMetric('Environment',r.environment ?? r.meta?.environment ?? indexMeta.environment)}${metric('Overall score',resolveOverallScore(r),'%')}</div>`;
const renderThirdParty = (r={})=>{const rows=r.domains||r; const arr=Array.isArray(rows)?rows:Object.entries(rows||{}).map(([d,v])=>({domain:d,...v})); return `<table><tr><th>Domain</th><th>Requests</th><th>Bytes</th><th>Avg duration</th><th>Tracker</th></tr>${arr.slice(0,150).map(x=>`<tr><td><button class="link" data-domain="${x.domain}">${x.domain}</button></td><td>${safe(x.requests ?? x.requestCount ?? 0)}</td><td>${fmt(x.transferSize ?? x.bytes,'bytes')}</td><td>${fmt(x.avgDurationMs ?? x.avgDuration,'ms')}</td><td>${x.trackerHeuristic?'Yes':'No'}</td></tr>`).join('')}</table>`;};
const renderThrottled = (r={})=>`<div class="kpis">${textMetric('Available',r.available===false?'Not executed':'Yes')}${metric('Baseline load',r.baselineLoadMs,'ms')}${metric('Throttled load',r.throttledLoadMs,'ms')}${metric('Degradation',r.degradationFactor,'x')}</div>`;
const renderVisualReg = (r={})=>`<div class="kpis">${textMetric('Baseline found',r.baselineFound)}${metric('Diff ratio',r.diffRatio)}${textMetric('Passed',r.passed)}</div>${r.baselineFound===false?'<p class="inline-hint">No baseline exists yet. Create one to enable visual change detection.</p><button>Create baseline from visual-current.png</button>':''}`;

const renderClientErrors = (r={})=>`<div class="kpis">${metric('Total errors',r.totalErrors)}${metric('Severity score',r.severityScore)}${metric('Console errors',r.consoleErrors)}${metric('Unhandled rejections',r.unhandledRejections)}</div><table><tr><th>Message</th><th>Count</th></tr>${(r.topErrors||[]).slice(0,20).map((item)=>`<tr><td>${safe(item.message)}</td><td>${safe(item.count)}</td></tr>`).join('')}</table>`;
const renderUxOverview = (r={})=>{
  const artifacts = r.signals?.artifacts || {};
  const rows = Object.entries(artifacts);
  const issues = (r.topIssues||[]).slice(0,20);
  return `<div class="kpis">${metric('UX suite score',r.score)}${textMetric('Status',r.meta?.status ?? r.status)}${metric('Top issues',(r.topIssues||[]).length)}${metric('Errors',(r.errors||[]).length)}</div>
  <table><tr><th>Artifact</th><th>Status</th><th>Score</th></tr>${rows.map(([k,v])=>`<tr><td>${safe(k)}</td><td>${safe(v.status)}</td><td>${safe(v.score)}</td></tr>`).join('')}</table>
  <h4>Top issues</h4><table><tr><th>ID</th><th>Severity</th><th>Title</th><th>Targets</th></tr>${issues.map((x)=>`<tr><td>${safe(x.id)}</td><td>${safe(x.severity)}</td><td>${safe(x.title)}</td><td>${renderIssueTargets(x.targets, x)}</td></tr>`).join('')}</table>${renderIssueVisualizationModal()}`;
};
const renderUxGeneric = (tab, r={})=>{
  const screens = tab === 'ux-visual-regression.json' ? `<div class="image-wrap"><a href="/artifacts/${encodeURIComponent(state.selectedId)}/ux-visual-above-the-fold.png" target="_blank">Above the fold screenshot</a><br><a href="/artifacts/${encodeURIComponent(state.selectedId)}/ux-visual-fullpage.png" target="_blank">Full page screenshot</a></div>` : '';
  return `<div class="kpis">${textMetric('Status',r.meta?.status ?? r.status)}${metric('Score',r.score)}${metric('Issues',(r.topIssues||[]).length)}${metric('Errors',(r.errors||[]).length)}</div>${screens}<h4>Signals</h4><pre>${escapeHtml(JSON.stringify(r.signals||{},null,2))}</pre><h4>Top issues</h4><table><tr><th>ID</th><th>Severity</th><th>Description</th><th>Targets</th></tr>${(r.topIssues||[]).map((x)=>`<tr><td>${safe(x.id)}</td><td>${safe(x.severity)}</td><td>${safe(x.description)}</td><td>${renderIssueTargets(x.targets, x)}</td></tr>`).join('')}</table>${renderIssueVisualizationModal()}`;
};
const renderMemoryLeaks = (r={})=>`<div class="kpis">${textMetric('Mode',r.mode)}${metric('Initial heap',r.initialHeapMB,'MB')}${metric('Final heap',r.finalHeapMB,'MB')}${metric('Growth',r.growthMB,'MB')}${textMetric('Leak risk',r.leakRisk)}</div><ul>${(r.evidence||[]).map((line)=>`<li>${safe(line)}</li>`).join('')}</ul>`;
const renderPrivacyAudit = (r={})=>`<div class="kpis">${textMetric('Consent banner detected',r.consentBannerDetected)}${metric('Cookies before consent',(r.cookiesBeforeConsent||[]).length)}${metric('Insecure cookies',(r.insecureCookies||[]).length)}${metric('Trackers before consent',(r.thirdPartyTrackers||[]).length)}${textMetric('GDPR risk',r.gdprRisk)}</div>`;
const renderRuntimeSecurity = (r={})=>`<div class="kpis">${metric('Security score',r.securityScore)}${textMetric('CSP strength',r.cspStrength)}${metric('Missing headers',(r.missingHeaders||[]).length)}${metric('Mixed content',(r.mixedContent||[]).length)}${metric('Eval signals',r.evalSignals)}</div>`;
const renderDependencyRisk = (r={})=>`<div class="kpis">${metric('Dependency risk score',r.dependencyRiskScore)}${metric('Third-party domains',(r.domainInventory||[]).length)}</div><table><tr><th>Domain</th><th>Category</th><th>Scripts</th></tr>${(r.domainInventory||[]).slice(0,50).map((item)=>`<tr><td>${safe(item.domain)}</td><td>${safe(item.category)}</td><td>${safe(item.scripts)}</td></tr>`).join('')}</table>`;
const renderRegressionSummary = (r={})=> {
  if(r.baseline === 'no baseline') return `<div class="state na">No baseline available yet. Run again to enable comparisons.</div>`;
  return `<div class="kpis">${textMetric('Compared run',r.comparedRun)}${metric('OK',r.summary?.ok ?? 0)}${metric('Watch',r.summary?.watch ?? 0)}${metric('Elevated',r.summary?.elevated ?? 0)}</div><table><tr><th>Target</th><th>Risk</th><th>Client error Δ</th><th>Security Δ</th></tr>${(r.targets||[]).map((item)=>`<tr><td>${safe(item.targetName)}</td><td>${safe(item.riskLevel)}</td><td>${safe(item.deltas?.clientErrorSeverityDelta)}</td><td>${safe(item.deltas?.runtimeSecurityDelta)}</td></tr>`).join('')}</table>`;
};


logEvent('INFO','UI startup',{view:'startup'});
state.theme = applyTheme(state.theme);
window.addEventListener('hashchange', ()=>{
  if(!state.sections || !state.index) return;
  if(syncTabFromLocation()) render();
});
loadIndex().catch((e)=>{logEvent('ERROR','UI startup failed',{view:'startup',errorMessage:e.message}); app.innerHTML=`<p>Failed to load dashboard: ${e.message}</p>`;});
