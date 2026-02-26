const app = document.getElementById('app');
const NAV = ['Overview','Portfolio','Trends','CI Health','URL Detail','Compare'];
let model;

const safe = (v, d='Not available') => (v===undefined||v===null||v==='')?d:v;
const fmt = (n) => Number.isFinite(Number(n)) ? Number(n).toFixed(0) : 'N/A';

function renderLayout(content, active='Overview'){
  app.innerHTML = `<div class="layout"><aside class="nav"><h1>Quality Intelligence Cockpit</h1>${NAV.map(n=>`<a href="#${n}" class="${n===active?'active':''}">${n}</a>`).join('')}</aside><main class="main">${content}</main></div>`;
}

function scoreBars(items, mapper){
  return `<div class="chart">${items.map(i=>{const v=Math.max(2,Math.min(100,mapper(i)));return `<div class="bar" style="height:${v}%"><span>${fmt(v)}</span></div>`}).join('')}</div>`;
}

function overview(){
  const urls = model.urls;
  const cards = urls.map(u=>`<div class="card"><div class="metric"><b>${u.url}</b><span class="badge ${u.status}">${u.status}</span></div><div class="metric"><span>Overall</span><b>${u.overallScore} (${u.grade})</b></div><div class="metric"><span>Environment</span><b>${safe(u.environment)}</b></div><div class="metric"><span>Last run</span><b>${safe(u.lastRunAt)}</b></div></div>`).join('');
  const release = (model.globalArtifacts['ci-summary.json']?.qualityGate || 'REVIEW').toString().toUpperCase();
  renderLayout(`<h2>Executive Overview</h2><div class="card"><b>Release decision: ${release==='PASS'?'CAN DEPLOY':release==='FAIL'?'BLOCK':'REVIEW'}</b></div><div class="row section">${cards}</div><div class="row section"><div class="card"><h3>Overall Score Distribution</h3>${scoreBars(urls,u=>u.overallScore)}</div><div class="card"><h3>Performance Trend (history)</h3>${model.globalArtifacts['history.json']?scoreBars(Object.values(model.globalArtifacts['history.json']),h=>h.performanceScore||40):'<p class="muted">Not available</p>'}</div></div>`, 'Overview');
}

function portfolio(){
  const q = new URLSearchParams(location.hash.split('?')[1]||'');
  const search = (q.get('search')||'').toLowerCase(); const status=q.get('status')||'ALL'; const sort=q.get('sort')||'score';
  let rows=[...model.urls].filter(u=>u.url.toLowerCase().includes(search)&&(status==='ALL'||u.status===status));
  rows.sort((a,b)=> sort==='reg'?b.regressions-a.regressions : sort==='worst'?Math.min(...Object.values(b.categoryScores).map(c=>c.value))-Math.min(...Object.values(a.categoryScores).map(c=>c.value)) : b.overallScore-a.overallScore);
  renderLayout(`<h2>Portfolio</h2><div class="controls"><input id="s" placeholder="Search URL" value="${search}"><select id="st"><option>ALL</option><option>PASS</option><option>WARN</option><option>FAIL</option></select><select id="so"><option value="score">overall score</option><option value="worst">worst category</option><option value="reg">most regressions</option></select></div><div class="row">${rows.map(u=>`<div class="card"><div class="metric"><b>${u.url}</b><span class="badge ${u.status}">${u.status}</span></div><div class="metric"><span>Overall</span><b>${u.overallScore}</b></div><div class="metric"><span>Throttled</span><b>${u.hasThrottled?'Yes':'No'}</b></div><div class="metric"><span>Regressions</span><b>${u.regressions}</b></div></div>`).join('')}</div><div class="row section"><div class="card"><h3>Category summary</h3>${scoreBars(rows,u=>u.categoryScores.performance.value)}</div><div class="card"><h3>Accessibility summary</h3>${scoreBars(rows,u=>u.categoryScores.accessibility.value)}</div></div>`, 'Portfolio');
  document.getElementById('st').value=status; document.getElementById('so').value=sort;
  ['s','st','so'].forEach(id=>document.getElementById(id).onchange=()=>location.hash=`Portfolio?search=${encodeURIComponent(document.getElementById('s').value)}&status=${document.getElementById('st').value}&sort=${document.getElementById('so').value}`);
}

function urlDetail(){
  const id = (new URLSearchParams(location.hash.split('?')[1]||'')).get('id') || model.urls[0]?.id;
  const u = model.urls.find(x=>x.id===id);
  if(!u){renderLayout('<p>No URL data</p>','URL Detail'); return;}
  const a=u.artifacts;
  const recs = ['network-recommendations.json','accessibility.json','seo-checks.json'].flatMap(k=> (a[k]?.recommendations||a[k]?.issues||[])).slice(0,5);
  renderLayout(`<h2>URL Detail: ${u.url}</h2><div class="controls"><select id="uid">${model.urls.map(x=>`<option value="${x.id}">${x.url}</option>`).join('')}</select></div>
  <div class="row"><div class="card"><h3>Executive</h3><div class="metric"><span>Overall weighted score</span><b>${u.overallScore}</b></div><div class="metric"><span>Status</span><span class="badge ${u.status}">${u.status}</span></div><div class="metric"><span>Risk level</span><b>${u.status==='FAIL'?'High':u.status==='WARN'?'Medium':'Low'}</b></div><div class="metric"><span>Production readiness</span><b>${Math.max(0,u.overallScore-u.blockers.length*8)}</b></div><ul>${recs.map(r=>`<li>${typeof r==='string'?r:(r.title||r.id||'Recommendation')}</li>`).join('')||'<li>Not available</li>'}</ul></div>
  <div class="card"><h3>Performance & CWV</h3><div class="metric"><span>LCP</span><b>${safe(a['core-web-vitals.json']?.lcpMs)}</b></div><div class="metric"><span>CLS</span><b>${safe(a['core-web-vitals.json']?.cls)}</b></div><div class="metric"><span>INP/FID</span><b>${safe(a['core-web-vitals.json']?.inpMs||a['core-web-vitals.json']?.fidMs)}</b></div><div class="metric"><span>TTFB</span><b>${safe(a['core-web-vitals.json']?.ttfbMs)}</b></div><div class="metric"><span>Total requests</span><b>${a['network-requests.json']?.length||0}</b></div><div class="metric"><span>Memory leak indicator</span><b>${safe(a['memory-profile.json']?.leakRisk)}</b></div></div>
  <div class="card"><h3>Accessibility</h3><div class="metric"><span>Total violations</span><b>${safe(a['accessibility.json']?.totalViolations||a['accessibility.json']?.issues?.length,0)}</b></div><table class="table"><tr><th>Rule</th><th>Description</th><th>Nodes</th></tr>${(a['accessibility.json']?.issues||[]).slice(0,8).map(i=>`<tr><td>${i.id||'n/a'}</td><td>${i.description||'n/a'}</td><td>${i.nodes||0}</td></tr>`).join('')||'<tr><td colspan="3">Not available</td></tr>'}</table></div></div>
  <div class="row section"><div class="card"><h3>Security & Third-party Risk</h3><div class="metric"><span>Critical findings</span><b>${safe(a['security-scan.json']?.criticalCount,0)}</b></div><div class="metric"><span>Missing headers</span><b>${safe(a['security-scan.json']?.missingHeaders?.length,0)}</b></div><div class="muted">Confirmed findings and derived risk data are mixed only where source omits separation.</div></div>
  <div class="card"><h3>Network Optimization</h3><div class="metric"><span>Opportunities</span><b>${safe(a['network-recommendations.json']?.length,0)}</b></div><div class="metric"><span>Estimated savings</span><b>${safe(a['network-recommendations.json']?.reduce((t,x)=>t+(x.estimatedSavingsKb||0),0))}</b></div></div>
  <div class="card"><h3>Stability</h3><div class="metric"><span>Broken links</span><b>${safe(a['broken-links.json']?.brokenCount,0)}</b></div><div class="metric"><span>API failure rate</span><b>${safe(a['api-monitoring.json']?.failureRate,0)}</b></div><div class="metric"><span>Production blocker</span><b>${u.blockers.length>0?'Yes':'No'}</b></div></div>
  <div class="card"><h3>SEO</h3><ul><li>Meta tags: ${a['seo-checks.json']?.metaComplete?'✅':'⚠️'}</li><li>Canonical: ${a['seo-checks.json']?.canonicalValid?'✅':'⚠️'}</li><li>Structured data: ${a['seo-checks.json']?.structuredData?'✅':'⚠️'}</li><li>Robots/indexing: ${a['seo-checks.json']?.robotsOk?'✅':'⚠️'}</li></ul></div>
  <div class="card"><h3>Visual Regression</h3><div class="metric"><span>Diff score</span><b>${safe(a['visual-regression.json']?.diffScore)}</b></div><div class="metric"><span>Changed regions</span><b>${safe(a['visual-regression.json']?.changedRegions)}</b></div>${u.images['visual-current.png']?`<img src="${u.images['visual-current.png']}" style="max-width:100%;border-radius:8px">`:'<p class="muted">Current image not available</p>'}<p class="muted">Baseline/Diff may be unavailable.</p></div></div>`, 'URL Detail');
  document.getElementById('uid').value=id; document.getElementById('uid').onchange=(e)=>location.hash=`URL Detail?id=${e.target.value}`;
}

function compare(){
  const rows=model.urls.slice(0,4);
  renderLayout(`<h2>Compare</h2><div class="card"><table class="table"><tr><th>URL</th><th>Overall</th><th>Performance</th><th>A11y</th><th>Security</th><th>Regressions</th></tr>${rows.map(u=>`<tr><td>${u.url}</td><td>${u.overallScore}</td><td>${u.categoryScores.performance.value}</td><td>${u.categoryScores.accessibility.value}</td><td>${u.categoryScores.security.value}</td><td>${u.regressions}</td></tr>`).join('')}</table></div>`, 'Compare');
}

function ci(){
  const ci = model.globalArtifacts['ci-summary.json']||{};
  renderLayout(`<h2>CI Health</h2><div class="card"><h3>Quality gate: ${(ci.qualityGate||'REVIEW')}</h3><div class="metric"><span>Pass</span><b>${safe(ci.passCount,0)}</b></div><div class="metric"><span>Fail</span><b>${safe(ci.failCount,0)}</b></div><div class="metric"><span>Top failing checks</span><b>${safe((ci.failingChecks||[]).join(', '))}</b></div></div>`, 'CI Health');
}

function trends(){
  const h=model.globalArtifacts['history.json'];
  renderLayout(`<h2>Trends</h2>${h?`<div class="row"><div class="card"><h3>Performance score trend</h3>${scoreBars(Object.values(h),x=>x.performanceScore||40)}</div><div class="card"><h3>Regression count trend</h3>${scoreBars(Object.values(h),x=>Math.min(100,(x.regressions||0)*10))}</div></div>`:'<p class="muted">history.json not available.</p>'}`,'Trends');
}

function route(){
  const page=(decodeURIComponent((location.hash||'#Overview').slice(1)).split('?')[0]);
  if(page==='Portfolio') return portfolio(); if(page==='Trends') return trends(); if(page==='CI Health') return ci(); if(page==='URL Detail') return urlDetail(); if(page==='Compare') return compare(); return overview();
}

fetch('/api/model').then(r=>r.json()).then((data)=>{model=data; route(); window.addEventListener('hashchange',route);}).catch((e)=>{app.innerHTML=`<p>Failed to load dashboard data: ${e.message}</p>`});
