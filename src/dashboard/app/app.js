const app = document.getElementById('app');

const state = {
  index: null,
  sections: null,
  selectedId: null,
  selectedTab: 'target-summary.json',
  search: '',
  regex: false,
  selectedDomain: null,
  facets: { failures:false, broken:false, visualFailed:false, throttled:false, lighthouse:false, a11y:new Set() },
  sorts: { netRec: { key: 'severity', dir: 'asc' }, netReq: { key: 'url', dir: 'asc' }, stability: { key: 'index', dir: 'asc' } }
};

const MISSING = '—';
const safe = (v, fallback=MISSING) => (v === null || v === undefined || v === '' ? fallback : v);
const toNum = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

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
  if(fromHash && fromHash !== state.selectedTab){
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
  state.selectedTab = hashTab && validTabs.has(hashTab) ? hashTab : state.sections.order[0];
}

async function loadIndex(){
  const opId = createOperationId();
  const started = performance.now();
  await logEvent('INFO', 'UI index load started', { operationId: opId, view: 'index' });
  const [indexRes] = await Promise.all([fetch('/api/index'), loadSectionConfig()]);
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
    if(state.facets.lighthouse && u.sections['lighthouse-summary.json']?.state === 'missing') return false;
    if(state.facets.a11y.size){
      const sev = u.sections['accessibility.json']?.summary || {};
      const has = [...state.facets.a11y].some((s)=> (sev[s] ?? 0) > 0);
      if(!has) return false;
    }
    return true;
  });
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
        <div class="row-badges">${badge(u.badges.a11y)}${badge(u.badges.perf)}${badge(u.badges.net)}${badge(u.badges.sec)}${badge(u.badges.seo)}${badge(u.badges.visual)}${badge(u.badges.stability)}</div>
      </button>`;
    }).join('')}</div>`;
    container.querySelectorAll('.url-row').forEach((el)=>el.onclick=()=>{const operationId=createOperationId(); state.selectedId=el.dataset.id; state.selectedDomain=null; logEvent('INFO','UI URL selection changed',{operationId,urlId:state.selectedId,view:state.selectedTab}); render();});
  };
  container.onscroll = renderRows;
  renderRows();
}

function renderDetailsShell(u){
  const a11y = u.sections['accessibility.json']?.summary || {};
  const netHi = u.sections['network-recommendations.json']?.summary?.high ?? MISSING;
  const sec = u.sections['security-scan.json']?.summary?.missingHeaders ?? MISSING;
  const broken = u.sections['broken-links.json']?.summary?.brokenCount ?? MISSING;
  const visual = u.sections['visual-regression.json']?.summary?.passed;
  return `<header class="detail-header">
    <h2>${u.url}</h2>
    <div class="meta">${safe(u.runTime)} · ${safe(u.runId)}</div>
    <div class="top-issues">
      <span>A11y C/S: ${a11y.critical??0}/${a11y.serious??0}</span>
      <span>High net recs: ${netHi}</span>
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
  const categories = state.sections.categories.map((category)=>`<button class="tab group-tab ${activeCategory?.id===category.id?'active':''}" data-group="${category.id}">${category.label}</button>`).join('');
  const sections = (activeCategory?.sections ?? []).map((section)=>{
    const label = state.sections.definitions[section].label;
    return `<button class="tab subgroup-tab ${state.selectedTab===section?'active':''}" data-tab="${section}">${label}</button>`;
  }).join('');
  return `<div class="tabs-sticky"><div class="tab-row groups-row" role="tablist" aria-label="Groups">${categories}</div><div class="tab-row subgroups-row" role="tablist" aria-label="Sub-groups">${sections}</div></div>`;
}

function bindFilters(){
  document.getElementById('search').oninput=(e)=>{const operationId=createOperationId(); state.search=e.target.value; logEvent('INFO','UI search changed',{operationId,view:'filters',search:summarizeInput(state.search)}); render({ preserveSearchFocus: true });};
  document.getElementById('regex').onchange=(e)=>{const operationId=createOperationId(); state.regex=e.target.checked; logEvent('INFO','UI regex toggle changed',{operationId,view:'filters',enabled:state.regex}); render();};
  document.getElementById('f-fail').onchange=(e)=>{state.facets.failures=e.target.checked; logEvent('INFO','UI facet changed',{operationId:createOperationId(),facet:'failures',enabled:state.facets.failures}); render();};
  document.getElementById('f-broken').onchange=(e)=>{state.facets.broken=e.target.checked; logEvent('INFO','UI facet changed',{operationId:createOperationId(),facet:'broken',enabled:state.facets.broken}); render();};
  document.getElementById('f-visual').onchange=(e)=>{state.facets.visualFailed=e.target.checked; logEvent('INFO','UI facet changed',{operationId:createOperationId(),facet:'visualFailed',enabled:state.facets.visualFailed}); render();};
  document.getElementById('f-throttle').onchange=(e)=>{state.facets.throttled=e.target.checked; logEvent('INFO','UI facet changed',{operationId:createOperationId(),facet:'throttled',enabled:state.facets.throttled}); render();};
  document.getElementById('f-lh').onchange=(e)=>{state.facets.lighthouse=e.target.checked; logEvent('INFO','UI facet changed',{operationId:createOperationId(),facet:'lighthouse',enabled:state.facets.lighthouse}); render();};
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
}

function bindTabEvents(u){
  document.querySelectorAll('[data-group]').forEach((button)=>button.onclick=()=>{
    const group = state.sections.categories.find((category)=>category.id===button.dataset.group);
    if(!group || !group.sections.length) return;
    const nextTab = group.sections.includes(state.selectedTab) ? state.selectedTab : group.sections[0];
    const operationId=createOperationId();
    state.selectedDomain=null;
    setSelectedTab(nextTab);
    logEvent('INFO','UI group changed',{operationId,urlId:u.id,group:group.id,section:nextTab,view:nextTab});
    render();
  });
  document.querySelectorAll('[data-tab]').forEach((button)=>button.onclick=()=>{
    const operationId=createOperationId();
    state.selectedDomain=null;
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

function rawPanel(raw){ return `<details><summary>Raw JSON</summary><pre>${raw?JSON.stringify(raw,null,2):MISSING}</pre></details>`; }

function fmt(value, unit=''){ const n = toNum(value); if(n===null) return MISSING; const rounded = Number.isInteger(n) ? n : Number(n.toFixed(2)); return `${rounded}${unit ? ` ${unit}` : ''}`; }
function metric(label, value, unit=''){ return `<div class="kpi"><span>${label}</span><strong>${fmt(value, unit)}</strong></div>`; }
function textMetric(label, value){ return `<div class="kpi"><span>${label}</span><strong>${safe(value)}</strong></div>`; }
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
    case 'api-monitoring.json': body = renderApi(unwrapped.payload); break;
    case 'broken-links.json': body = renderBroken(unwrapped.payload); break;
    case 'core-web-vitals.json': body = renderCwv(unwrapped.payload); break;
    case 'lighthouse-summary.json': body = renderLighthouse(unwrapped.payload); break;
    case 'memory-profile.json': body = renderMemory(unwrapped.payload); break;
    case 'network-recommendations.json': body = renderNetRec(unwrapped.payload); break;
    case 'network-requests.json': body = renderNetReq(unwrapped.payload); break;
    case 'performance.json': body = renderPerformance(unwrapped.payload); break;
    case 'security-scan.json': body = renderSecurity(unwrapped.payload); break;
    case 'seo-checks.json': body = renderSeo(unwrapped.payload); break;
    case 'stability.json': body = renderStability(unwrapped.payload); break;
    case 'target-summary.json': body = renderTarget(unwrapped.payload, unwrapped.meta, selected); break;
    case 'third-party-risk.json': body = renderThirdParty(unwrapped.payload); break;
    case 'throttled-run.json': body = renderThrottled(unwrapped.payload); break;
    case 'visual-current.png': body = payload.summary?.image ? `<div class="image-wrap"><img src="${payload.summary.image}"></div>` : `<p>${MISSING}</p>`; break;
    case 'visual-regression.json': body = renderVisualReg(unwrapped.payload); break;
    default: body = '<p>Unsupported section</p>';
  }
  el.innerHTML = `${head}${body}${rawPanel(raw)}`;
  logEvent(Math.round(performance.now()-started)>500?'WARN':'INFO','UI section render completed',{operationId,urlId:id,section:tab,view:tab,durationMs:Math.round(performance.now()-started),state:payload.state});

  el.querySelectorAll('[data-domain]').forEach((b)=>b.onclick=()=>{state.selectedDomain=b.dataset.domain; state.selectedTab='network-requests.json'; render();});
  el.querySelectorAll('[data-sort-scope]').forEach((btn)=>btn.onclick=()=>{const scope=btn.dataset.sortScope;const key=btn.dataset.sortKey;const current=state.sorts[scope];state.sorts[scope]={key,dir:current.key===key&&current.dir==='asc'?'desc':'asc'};loadTab(id, tab);});
}

const renderA11yHeuristics = (r={})=>{
  const score = toNum(r.contrastSimulationScore);
  const reason = safe(r.contrastSimulationScoreReason, '');
  const scoreValue = score === null ? MISSING : score;
  return `<div class="kpis">${textMetric('keyboardReachable',String(r.keyboardReachable))}${textMetric('possibleFocusTrap',String(r.possibleFocusTrap))}${textMetric('contrastSimulationScore',scoreValue)}</div>${score===null&&reason?`<p>contrastSimulationScore reason: ${reason}</p>`:''}<p>Manual checks are shown when flags indicate potential focus/keyboard issues.</p>`;
};
const renderAxe = (r={})=>{ const issues=r.issues||[]; return `<div class="kpis">${['critical','serious','moderate','minor'].map(s=>metric(s,r.counters?.[s]??r[s]??0)).join('')}</div><table><tr><th>Rule</th><th>Impact</th><th>Description</th><th>Nodes</th></tr>${issues.slice(0,200).map(i=>`<tr><td>${safe(i.id)}</td><td>${safe(i.impact)}</td><td>${safe(i.description)}</td><td>${safe(i.nodes?.length ?? i.nodes)}</td></tr>`).join('')}</table>`; };
const renderApi = (r={})=>`<div class="kpis">${metric('Count',r.count,'','Total API endpoints tested')}${metric('Error rate',(toNum(r.errorRate)??0)*100,'%','API responses with status >= 400')}${metric('P95 latency',r.p95LatencyMs ?? r.p95Ms,'ms','95th percentile response latency')}${metric('Avg payload',r.avgPayloadSize ?? r.avgSize,'bytes','Mean API payload size')}</div>`;
const renderBroken = (r={})=>`<div class="kpis">${metric('Checked',r.checkedCount ?? r.checked)}${metric('Broken',r.brokenCount ?? r.broken)}${metric('Redirect chains',r.redirectChains)}${metric('Loops',r.loops)}</div>`;
const renderCwv = (r={})=>{const vals=[toNum(r.lcpMs ?? r.lcp),toNum(r.cls),toNum(r.inpMs ?? r.inp),toNum(r.fcpMs ?? r.fcp)]; const ready=Math.round(vals.filter((v)=>v!==null).length/4*100); return `<div class="kpis">${metric('LCP',r.lcpMs ?? r.lcp,'ms','Largest Contentful Paint')}${metric('CLS',r.cls)}${metric('INP',r.inpMs ?? r.inp,'ms','Interaction to Next Paint')}${metric('FCP',r.fcpMs ?? r.fcp,'ms','First Contentful Paint')}${metric('Readiness',ready,'%')}</div>`};
const renderLighthouse = (r={})=>`<div class="kpis">${metric('Performance',r.performance ?? r.categories?.performance,'%')}${metric('Accessibility',r.accessibility ?? r.categories?.accessibility,'%')}${metric('SEO',r.seo ?? r.categories?.seo,'%')}${metric('Best practices',r.bestPractices ?? r.categories?.bestPractices,'%')}</div>`;
const renderMemory = (r={})=>`<div>${metric('Growth',r.growth ?? r.growthVerdict,'bytes')}<pre>${(r.samples||[]).slice(0,20).map((x)=>Math.round(x)).join(', ')}</pre></div>`;
const renderNetRec = (r=[])=>{const arr=(Array.isArray(r)?r:(r.recommendations||[])).map((x)=>({title:safe(x.title,x.id),description:safe(x.description,''),severity:safe(x.severity,'unknown'),count:toNum(x.impactedCount)??0})); const sorted=sortRows(arr,state.sorts.netRec); return `<table><tr>${sortableHeader('Title','netRec','title')}${sortableHeader('Description','netRec','description')}${sortableHeader('Severity','netRec','severity')}${sortableHeader('Count','netRec','count')}</tr>${sorted.slice(0,120).map(x=>`<tr><td>${x.title}</td><td>${x.description}</td><td>${x.severity}</td><td>${x.count}</td></tr>`).join('')}</table>`;};
const renderNetReq = (r=[])=>{let arr=Array.isArray(r)?r:(r.requests||[]); if(state.selectedDomain) arr=arr.filter((x)=>String(x.url||'').includes(state.selectedDomain)); const rows=arr.map((x)=>({method:safe(x.method),status:toNum(x.status)??0,type:safe(x.type ?? x.resourceType),transfer:toNum(x.transferSize)??0,duration:toNum(x.durationMs ?? x.duration)??0,cache:safe(x.cacheStatus ?? (x.fromCache ? 'HIT':'MISS') ?? x.cached),url:safe(x.url)})); const sorted=sortRows(rows,state.sorts.netReq); return `<div class="kpis">${metric('Rows',arr.length)}${textMetric('Domain filter',state.selectedDomain||'None')}</div><table><tr>${sortableHeader('Method','netReq','method')}${sortableHeader('Status','netReq','status')}${sortableHeader('Type','netReq','type')}${sortableHeader('Transfer','netReq','transfer')}${sortableHeader('Duration','netReq','duration')}${sortableHeader('Cache','netReq','cache')}${sortableHeader('URL','netReq','url')}</tr>${sorted.slice(0,400).map(x=>`<tr><td>${x.method}</td><td>${x.status}</td><td>${x.type}</td><td>${fmt(x.transfer,'bytes')}</td><td>${fmt(x.duration,'ms')}</td><td>${x.cache}</td><td>${x.url}</td></tr>`).join('')}</table>`;};
const renderPerformance = (r={})=>{const n=r.navigation||{}; return `<div class="kpis">${metric('DNS',n.dnsMs,'ms')}${metric('TCP',n.tcpMs,'ms')}${metric('TTFB',n.ttfbMs,'ms')}${metric('DCL',n.domContentLoadedMs,'ms')}${metric('Load',n.loadEventMs,'ms')}${metric('FP',r.paint?.fpMs ?? r.paint?.['first-paint'],'ms')}${metric('FCP',r.paint?.fcpMs ?? r.paint?.['first-contentful-paint'],'ms')}</div>`;};
const renderSecurity = (r={})=>`<div class="kpis">${textMetric('TLS',r.tlsVersion)}${textMetric('Missing headers',Array.isArray(r.missingHeaders)?((r.missingHeaders||[]).join(', ')||'None'):'None')}</div>`;
const renderSeo = (r={})=>`<div class="kpis">${textMetric('Title',r.title)}${textMetric('Description',r.description)}${textMetric('Canonical',r.canonical)}${textMetric('Robots',r.robots ?? r.robotsMeta)}${metric('Structured data count',r.structuredDataCount)}</div><blockquote><strong>${safe(r.title,'(title missing)')}</strong><p>${safe(r.description,'(description missing)')}</p></blockquote>`;
const renderStability = (r={})=>{const samples=(r.loadEventSamples||[]).map((v,i)=>({index:i+1,sample:Math.round(v),timestamp:r.timestamps?.[i]??'n/a'})); const avg=samples.length?samples.reduce((sum,row)=>sum+row.sample,0)/samples.length:0; const sorted=sortRows(samples,state.sorts.stability); return `<div class="kpis">${metric('Iterations',r.iterations)}${metric('Std Dev',r.stdDev ?? r.stdDevLoadMs,'ms')}${metric('CV',r.coefficientOfVariation)}${textMetric('Unstable',r.unstable?'Yes':'No')}</div><table><tr>${sortableHeader('#','stability','index')}${sortableHeader('Load event','stability','sample')}${sortableHeader('Timestamp','stability','timestamp')}</tr>${sorted.slice(0,300).map(x=>`<tr class="${x.sample<=avg?'fast':'slow'}"><td>${x.index}</td><td>${fmt(x.sample,'ms')}</td><td>${x.timestamp}</td></tr>`).join('')}</table>`;};
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
const renderVisualReg = (r={})=>`<div class="kpis">${textMetric('Baseline found',r.baselineFound?'Yes':'No')}${metric('Diff ratio',r.diffRatio)}${textMetric('Passed',r.passed?'Yes':'No')}</div>${r.baselineFound===false?'<button>Create baseline from visual-current.png</button>':''}`;

logEvent('INFO','UI startup',{view:'startup'});
window.addEventListener('hashchange', ()=>{
  if(!state.sections || !state.index) return;
  if(syncTabFromLocation()) render();
});
loadIndex().catch((e)=>{logEvent('ERROR','UI startup failed',{view:'startup',errorMessage:e.message}); app.innerHTML=`<p>Failed to load dashboard: ${e.message}</p>`;});
