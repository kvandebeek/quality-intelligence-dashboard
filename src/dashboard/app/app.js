const app = document.getElementById('app');

const SECTION_ORDER = [
  'target-summary.json','a11y-beyond-axe.json','accessibility.json','api-monitoring.json','broken-links.json','core-web-vitals.json','lighthouse-summary.json','memory-profile.json','network-recommendations.json','network-requests.json','performance.json','security-scan.json','seo-checks.json','stability.json','third-party-risk.json','throttled-run.json','visual-current.png','visual-regression.json'
];

const state = {
  index: null,
  selectedId: null,
  selectedTab: 'target-summary.json',
  search: '',
  regex: false,
  selectedDomain: null,
  facets: { failures:false, broken:false, visualFailed:false, throttled:false, lighthouse:false, a11y:new Set() }
};

const safe = (v, fallback='Not available') => (v === null || v === undefined || v === '' ? fallback : v);
const toNum = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

async function loadIndex(){
  const res = await fetch('/api/index');
  if(!res.ok) throw new Error(`Failed to load index: ${res.status}`);
  state.index = await res.json();
  state.selectedId = state.index.urls[0]?.id ?? null;
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
    if(state.facets.lighthouse && u.sections['lighthouse-summary.json']?.state === 'missing') return false;
    if(state.facets.a11y.size){
      const sev = u.sections['accessibility.json']?.summary || {};
      const has = [...state.facets.a11y].some((s)=> (sev[s] ?? 0) > 0);
      if(!has) return false;
    }
    return true;
  });
}

function render(){
  if(!state.index){ app.innerHTML = '<p>Loading…</p>'; return; }
  const urls = filterUrls();
  const selected = urls.find((u)=>u.id===state.selectedId) ?? state.index.urls.find((u)=>u.id===state.selectedId) ?? urls[0];
  if(selected) state.selectedId = selected.id;
  app.innerHTML = `
  <div class="layout">
    <aside class="left">
      <div class="search-block">
        <input id="search" placeholder="Search URL or folder" value="${state.search.replace(/"/g,'&quot;')}">
        <label><input type="checkbox" id="regex" ${state.regex?'checked':''}> Regex</label>
      </div>
      <div class="facets">
        <label><input type="checkbox" id="f-fail" ${state.facets.failures?'checked':''}> Has failures</label>
        <label><input type="checkbox" id="f-broken" ${state.facets.broken?'checked':''}> Broken links &gt; 0</label>
        <label><input type="checkbox" id="f-visual" ${state.facets.visualFailed?'checked':''}> Visual regression failed</label>
        <label><input type="checkbox" id="f-throttle" ${state.facets.throttled?'checked':''}> Throttled run available</label>
        <label><input type="checkbox" id="f-lh" ${state.facets.lighthouse?'checked':''}> Lighthouse available</label>
        <div class="facet-inline">A11y severity:
          ${['critical','serious','moderate','minor'].map(s=>`<button class="pill ${state.facets.a11y.has(s)?'on':''}" data-sev="${s}">${s}</button>`).join('')}
        </div>
      </div>
      <div id="url-list" class="url-list"></div>
    </aside>
    <main class="main">${selected?renderDetailsShell(selected):'<p>No URLs match filters.</p>'}</main>
  </div>`;

  bindFilters();
  renderVirtualList(urls);
  if(selected) bindTabEvents(selected);
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
        <div class="row-badges">${badge(u.badges.a11y)}${badge(u.badges.perf)}${badge(u.badges.net)}${badge(u.badges.sec)}${badge(u.badges.seo)}${badge(u.badges.visual)}${badge(u.badges.stability)}</div>
      </button>`;
    }).join('')}</div>`;
    container.querySelectorAll('.url-row').forEach((el)=>el.onclick=()=>{state.selectedId=el.dataset.id; state.selectedDomain=null; render();});
  };
  container.onscroll = renderRows;
  renderRows();
}

function renderDetailsShell(u){
  const a11y = u.sections['accessibility.json']?.summary || {};
  const netHi = u.sections['network-recommendations.json']?.summary?.high ?? 'Not measured';
  const sec = u.sections['security-scan.json']?.summary?.missingHeaders ?? 'Not measured';
  const broken = u.sections['broken-links.json']?.summary?.brokenCount ?? 'Not measured';
  const visual = u.sections['visual-regression.json']?.summary?.passed;
  return `<header class="detail-header">
    <h2>${u.url}</h2>
    <div class="meta">${safe(u.timestamp,'Run time not available')} · ${safe(u.runId,'Run ID not available')}</div>
    <div class="top-issues">
      <span>A11y C/S: ${a11y.critical??0}/${a11y.serious??0}</span>
      <span>High net recs: ${netHi}</span>
      <span>Missing security headers: ${sec}</span>
      <span>Broken links: ${broken}</span>
      <span>Visual: ${visual===undefined?'Not measured':visual?'Pass':'Fail'}</span>
    </div>
  </header>
  <nav class="tabs">${SECTION_ORDER.map((s)=>`<button class="tab ${state.selectedTab===s?'active':''}" data-tab="${s}">${s.replace('.json','')}</button>`).join('')}</nav>
  <section id="tab-content" class="tab-content"><p>Loading ${state.selectedTab}…</p></section>
  <section class="parse-errors">${(state.index.parseErrors||[]).slice(-10).map((e)=>`<div>⚠ ${e.file}: ${e.message}</div>`).join('') || ''}</section>`;
}

function bindFilters(){
  document.getElementById('search').oninput=(e)=>{state.search=e.target.value; render();};
  document.getElementById('regex').onchange=(e)=>{state.regex=e.target.checked; render();};
  document.getElementById('f-fail').onchange=(e)=>{state.facets.failures=e.target.checked; render();};
  document.getElementById('f-broken').onchange=(e)=>{state.facets.broken=e.target.checked; render();};
  document.getElementById('f-visual').onchange=(e)=>{state.facets.visualFailed=e.target.checked; render();};
  document.getElementById('f-throttle').onchange=(e)=>{state.facets.throttled=e.target.checked; render();};
  document.getElementById('f-lh').onchange=(e)=>{state.facets.lighthouse=e.target.checked; render();};
  document.querySelectorAll('[data-sev]').forEach((btn)=>btn.onclick=()=>{const s=btn.dataset.sev; state.facets.a11y.has(s)?state.facets.a11y.delete(s):state.facets.a11y.add(s); render();});
}

function bindTabEvents(u){
  document.querySelectorAll('.tab').forEach((b)=>b.onclick=()=>{state.selectedTab=b.dataset.tab; state.selectedDomain=null; render();});
  loadTab(u.id,state.selectedTab);
}

function renderStateBox(stateName, reason=''){
  if(stateName==='missing') return `<div class="state missing">Missing / not executed</div>`;
  if(stateName==='not_available') return `<div class="state na">Not available: ${reason||'No reason provided'}</div>`;
  if(stateName==='error') return `<div class="state error">Malformed JSON</div>`;
  return '';
}

function rawPanel(raw){ return `<details><summary>Raw JSON</summary><pre>${raw?JSON.stringify(raw,null,2):'Not available'}</pre></details>`; }

async function loadTab(id, tab){
  const el = document.getElementById('tab-content');
  const res = await fetch(`/api/url/${encodeURIComponent(id)}/section/${encodeURIComponent(tab)}`);
  const payload = await res.json();
  const head = renderStateBox(payload.state,payload.summary?.reason);
  let body = '';
  const raw = payload.raw;

  switch(tab){
    case 'a11y-beyond-axe.json': body = renderA11yHeuristics(raw); break;
    case 'accessibility.json': body = renderAxe(raw); break;
    case 'api-monitoring.json': body = renderApi(raw); break;
    case 'broken-links.json': body = renderBroken(raw); break;
    case 'core-web-vitals.json': body = renderCwv(raw); break;
    case 'lighthouse-summary.json': body = renderLighthouse(raw); break;
    case 'memory-profile.json': body = renderMemory(raw); break;
    case 'network-recommendations.json': body = renderNetRec(raw); break;
    case 'network-requests.json': body = renderNetReq(raw); break;
    case 'performance.json': body = renderPerformance(raw); break;
    case 'security-scan.json': body = renderSecurity(raw); break;
    case 'seo-checks.json': body = renderSeo(raw); break;
    case 'stability.json': body = renderStability(raw); break;
    case 'target-summary.json': body = renderTarget(raw); break;
    case 'third-party-risk.json': body = renderThirdParty(raw); break;
    case 'throttled-run.json': body = renderThrottled(raw); break;
    case 'visual-current.png': body = payload.summary?.image ? `<div class="image-wrap"><img src="${payload.summary.image}"></div>` : '<p>Not available</p>'; break;
    case 'visual-regression.json': body = renderVisualReg(raw); break;
    default: body = '<p>Unsupported section</p>';
  }
  el.innerHTML = `${head}${body}${rawPanel(raw)}`;

  el.querySelectorAll('[data-domain]').forEach((b)=>b.onclick=()=>{state.selectedDomain=b.dataset.domain; state.selectedTab='network-requests.json'; render();});
}

const metric = (label, v)=>`<div class="kpi"><span>${label}</span><strong>${safe(v,'Not measured')}</strong></div>`;
const renderA11yHeuristics = (r={})=>`<div class="kpis">${Object.entries(r).slice(0,6).map(([k,v])=>metric(k,v===null?'Not measured':String(v))).join('')}</div><p>Manual checks are shown when flags indicate potential focus/keyboard issues.</p>`;
const renderAxe = (r={})=>{ const issues=r.issues||[]; return `<div class="kpis">${['critical','serious','moderate','minor'].map(s=>metric(s,r.counters?.[s]??r[s]??0)).join('')}</div><table><tr><th>Rule</th><th>Impact</th><th>Description</th><th>Nodes</th></tr>${issues.slice(0,200).map(i=>`<tr><td>${safe(i.id)}</td><td>${safe(i.impact)}</td><td>${safe(i.description)}</td><td>${safe(i.nodes?.length ?? i.nodes)}</td></tr>`).join('')}</table>`; };
const renderApi = (r={})=>`<div class="kpis">${metric('Count',r.count)}${metric('Error rate',r.errorRate)}${metric('P95 latency',r.p95LatencyMs)}${metric('Avg payload',r.avgPayloadSize)}</div>`;
const renderBroken = (r={})=>`<div class="kpis">${metric('Checked',r.checkedCount)}${metric('Broken',r.brokenCount)}${metric('Redirect chains',r.redirectChains)}${metric('Loops',r.loops)}</div>`;
const renderCwv = (r={})=>{const vals=['lcpMs','cls','inpMs','fcpMs'].map((k)=>toNum(r[k])); const ready=Math.round(vals.filter((v)=>v!==null).length/4*100); return `<div class="kpis">${metric('LCP',r.lcpMs)}${metric('CLS',r.cls)}${metric('INP',r.inpMs)}${metric('FCP',r.fcpMs)}${metric('Readiness',ready+'%')}</div>`};
const renderLighthouse = (r={})=>`<div class="kpis">${metric('Performance',r.performance)}${metric('Accessibility',r.accessibility)}${metric('SEO',r.seo)}${metric('Best practices',r.bestPractices)}</div>`;
const renderMemory = (r={})=>`<div>${metric('Growth verdict',r.growthVerdict===null?'Insufficient samples':r.growthVerdict)}<pre>${(r.samples||[]).slice(0,20).join(', ')}</pre></div>`;
const renderNetRec = (r=[])=>{const arr=Array.isArray(r)?r:(r.recommendations||[]); return `<div class="cards">${arr.slice(0,80).map(x=>`<article><h4>${safe(x.title,x.id)}</h4><p>${safe(x.description,'')}</p><small>${safe(x.severity)} · impacted ${safe(x.impactedCount,0)}</small></article>`).join('')}</div>`;};
const renderNetReq = (r=[])=>{let arr=Array.isArray(r)?r:(r.requests||[]); if(state.selectedDomain) arr=arr.filter((x)=>String(x.url||'').includes(state.selectedDomain)); return `<div class="kpis">${metric('Rows',arr.length)}${metric('Domain filter',state.selectedDomain||'None')}</div><table><tr><th>Method</th><th>Status</th><th>Type</th><th>Transfer</th><th>Duration</th><th>Cache</th><th>URL</th></tr>${arr.slice(0,400).map(x=>`<tr><td>${safe(x.method)}</td><td>${safe(x.status)}</td><td>${safe(x.type)}</td><td>${safe(x.transferSize)}</td><td>${safe(x.durationMs ?? x.duration)}</td><td>${safe(x.cacheStatus ?? x.cached)}</td><td>${safe(x.url)}</td></tr>`).join('')}</table>`;};
const renderPerformance = (r={})=>{const n=r.navigation||{}; return `<div class="kpis">${metric('DNS',n.dnsMs)}${metric('TCP',n.tcpMs)}${metric('TTFB',n.ttfbMs)}${metric('DCL',n.domContentLoadedMs)}${metric('Load',n.loadEventMs)}${metric('FP',r.paint?.fpMs)}${metric('FCP',r.paint?.fcpMs)}</div>`;};
const renderSecurity = (r={})=>`<div class="kpis">${metric('TLS',r.tlsVersion)}${metric('Missing headers',(r.missingHeaders||[]).join(', ')||'None')}</div>`;
const renderSeo = (r={})=>`<div class="kpis">${metric('Title',r.title)}${metric('Description',r.description)}${metric('Canonical',r.canonical)}${metric('Robots',r.robots)}${metric('Structured data count',r.structuredDataCount)}</div><blockquote><strong>${safe(r.title,'(title missing)')}</strong><p>${safe(r.description,'(description missing)')}</p></blockquote>`;
const renderStability = (r={})=>`<div class="kpis">${metric('Iterations',r.iterations)}${metric('Std Dev',r.stdDev)}${metric('CV',r.coefficientOfVariation)}${metric('Unstable',r.unstable?'Yes':'No')}</div>`;
const renderTarget = (r={})=>`<div class="kpis">${metric('URL',r.url)}${metric('Run ID',r.runId)}${metric('Environment',r.environment)}${metric('Overall score',r.overallScore)}</div>`;
const renderThirdParty = (r={})=>{const rows=r.domains||r; const arr=Array.isArray(rows)?rows:Object.entries(rows||{}).map(([d,v])=>({domain:d,...v})); return `<table><tr><th>Domain</th><th>Requests</th><th>Bytes</th><th>Avg duration</th><th>Tracker</th></tr>${arr.slice(0,150).map(x=>`<tr><td><button class="link" data-domain="${x.domain}">${x.domain}</button></td><td>${safe(x.requests)}</td><td>${safe(x.transferSize)}</td><td>${safe(x.avgDurationMs)}</td><td>${x.trackerHeuristic?'Yes':'No'}</td></tr>`).join('')}</table>`;};
const renderThrottled = (r={})=>`<div class="kpis">${metric('Available',r.available===false?'Not executed':'Yes')}${metric('Baseline load',r.baselineLoadMs)}${metric('Throttled load',r.throttledLoadMs)}${metric('Degradation',r.degradationFactor)}</div>`;
const renderVisualReg = (r={})=>`<div class="kpis">${metric('Baseline found',r.baselineFound?'Yes':'No')}${metric('Diff ratio',r.diffRatio)}${metric('Passed',r.passed?'Yes':'No')}</div>${r.baselineFound===false?'<button>Create baseline from visual-current.png</button>':''}`;

loadIndex().catch((e)=>{app.innerHTML=`<p>Failed to load dashboard: ${e.message}</p>`;});
