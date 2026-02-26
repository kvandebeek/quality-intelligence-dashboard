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
  facets: { failures:false, broken:false, visualFailed:false, throttled:false, lighthouse:false, a11y:new Set() },
  sorts: { netRec: { key: 'severity', dir: 'asc' }, netReq: { key: 'url', dir: 'asc' }, stability: { key: 'index', dir: 'asc' } }
};

const safe = (v, fallback='Not available') => (v === null || v === undefined || v === '' ? fallback : v);
const toNum = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const INFO = 'ⓘ';

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

function infoTip(text){ return `<span class="info-tip" title="${String(text).replace(/"/g,'&quot;')}">${INFO}</span>`; }
function fmt(value, unit=''){ const n = toNum(value); if(n===null) return 'Not measured'; const rounded = Number.isInteger(n) ? n : Number(n.toFixed(2)); return `${rounded}${unit ? ` ${unit}` : ''}`; }
function metric(label, value, unit='', description=''){ return `<div class="kpi"><span>${label} ${description ? infoTip(description) : ''}</span><strong>${fmt(value, unit)}</strong></div>`; }
function textMetric(label, value, description=''){ return `<div class="kpi"><span>${label} ${description ? infoTip(description) : ''}</span><strong>${safe(value,'Not measured')}</strong></div>`; }
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
  const el = document.getElementById('tab-content');
  const res = await fetch(`/api/url/${encodeURIComponent(id)}/section/${encodeURIComponent(tab)}`);
  const payload = await res.json();
  const head = renderStateBox(payload.state,payload.summary?.reason);
  let body = '';
  const raw = payload.raw;
  const unwrapped = unwrapArtifact(raw);

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
    case 'target-summary.json': body = renderTarget(unwrapped.payload, unwrapped.meta); break;
    case 'third-party-risk.json': body = renderThirdParty(unwrapped.payload); break;
    case 'throttled-run.json': body = renderThrottled(unwrapped.payload); break;
    case 'visual-current.png': body = payload.summary?.image ? `<div class="image-wrap"><img src="${payload.summary.image}"></div>` : '<p>Not available</p>'; break;
    case 'visual-regression.json': body = renderVisualReg(unwrapped.payload); break;
    default: body = '<p>Unsupported section</p>';
  }
  el.innerHTML = `${head}${body}${rawPanel(raw)}`;

  el.querySelectorAll('[data-domain]').forEach((b)=>b.onclick=()=>{state.selectedDomain=b.dataset.domain; state.selectedTab='network-requests.json'; render();});
  el.querySelectorAll('[data-sort-scope]').forEach((btn)=>btn.onclick=()=>{const scope=btn.dataset.sortScope;const key=btn.dataset.sortKey;const current=state.sorts[scope];state.sorts[scope]={key,dir:current.key===key&&current.dir==='asc'?'desc':'asc'};loadTab(id, tab);});
}

const renderA11yHeuristics = (r={})=>`<div class="kpis">${Object.entries(r).slice(0,6).map(([k,v])=>textMetric(k,v===null?'Not measured':String(v))).join('')}</div><p>Manual checks are shown when flags indicate potential focus/keyboard issues.</p>`;
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
const renderTarget = (r={}, m={})=>`<div class="kpis">${textMetric('URL',r.url ?? r.target?.url ?? m.url)}${textMetric('Run ID',r.runId ?? m.runId)}${textMetric('Environment',r.environment ?? r.meta?.environment)}${metric('Overall score',r.overallScore ?? r.enterpriseScore ?? r.score,'%')}</div>`;
const renderThirdParty = (r={})=>{const rows=r.domains||r; const arr=Array.isArray(rows)?rows:Object.entries(rows||{}).map(([d,v])=>({domain:d,...v})); return `<table><tr><th>Domain</th><th>Requests</th><th>Bytes</th><th>Avg duration</th><th>Tracker</th></tr>${arr.slice(0,150).map(x=>`<tr><td><button class="link" data-domain="${x.domain}">${x.domain}</button></td><td>${safe(x.requests ?? x.requestCount ?? 0)}</td><td>${fmt(x.transferSize ?? x.bytes,'bytes')}</td><td>${fmt(x.avgDurationMs ?? x.avgDuration,'ms')}</td><td>${x.trackerHeuristic?'Yes':'No'}</td></tr>`).join('')}</table>`;};
const renderThrottled = (r={})=>`<div class="kpis">${textMetric('Available',r.available===false?'Not executed':'Yes')}${metric('Baseline load',r.baselineLoadMs,'ms')}${metric('Throttled load',r.throttledLoadMs,'ms')}${metric('Degradation',r.degradationFactor,'x')}</div>`;
const renderVisualReg = (r={})=>`<div class="kpis">${textMetric('Baseline found',r.baselineFound?'Yes':'No')}${metric('Diff ratio',r.diffRatio)}${textMetric('Passed',r.passed?'Yes':'No')}</div>${r.baselineFound===false?'<button>Create baseline from visual-current.png</button>':''}`;

loadIndex().catch((e)=>{app.innerHTML=`<p>Failed to load dashboard: ${e.message}</p>`;});
