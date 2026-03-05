import fs from 'node:fs';
import path from 'node:path';
import type { Page } from 'playwright';
import type { AppConfig } from '../models/types.js';
import { writeJson } from '../utils/file.js';

export type UxStatus = 'pass'|'warn'|'fail'|'partial'|'skipped';
export type UxIssueTarget = string | { selector: string; label?: string; [key: string]: unknown };
export interface UxArtifact {
  meta: { runId: string; url: string; timestamp: string; browserName: string; viewport: { width:number; height:number }; durationMs: number; status: UxStatus };
  score: number | null;
  signals: Record<string, unknown>;
  topIssues: Array<{ id:string; title:string; severity:'info'|'low'|'medium'|'high'; description:string; evidence?: Record<string, unknown>; targets?: UxIssueTarget[] }>;
  errors: Array<{ step:string; message:string }>;
  recommendations: Array<{ title:string; detail:string }>;
}

const DESTRUCTIVE = ['logout','delete','remove','unsubscribe','sign out','pay','purchase','checkout'];
const SOFT_404 = ['not found','page not found','404','does not exist','can\'t be found'];

const now = () => Date.now();
const clamp = (v:number, min:number, max:number) => Math.max(min, Math.min(max, v));

export function normalizeSelector(selector: string): string {
  return selector
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\s*([>+~])\s*/g, ' $1 ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s+/g, ' ');
}

export function normalizeUxIssueTargets(targets: UxIssueTarget[]): UxIssueTarget[] {
  const seen = new Set<string>();
  const normalized: UxIssueTarget[] = [];
  for (const target of targets) {
    if (typeof target === 'string') {
      const selector = normalizeSelector(target);
      if (!selector || seen.has(selector)) continue;
      seen.add(selector);
      normalized.push(selector);
      continue;
    }
    const selector = typeof target.selector === 'string' ? normalizeSelector(target.selector) : '';
    if (!selector || seen.has(selector)) continue;
    seen.add(selector);
    normalized.push({ ...target, selector });
  }
  return normalized.sort((a, b) => {
    const left = typeof a === 'string' ? a : a.selector;
    const right = typeof b === 'string' ? b : b.selector;
    return left.localeCompare(right);
  });
}

function makeBase(context: { runId:string; url:string; timestamp:string; browserName:string; viewport:{width:number;height:number} }): UxArtifact {
  return { meta: { ...context, durationMs: 0, status:'pass' }, score: 100, signals: {}, topIssues: [], errors: [], recommendations: [] };
}

function finalize(artifact: UxArtifact, started: number): UxArtifact {
  artifact.meta.durationMs = now() - started;
  if (artifact.meta.status !== 'skipped' && artifact.score !== null) artifact.score = clamp(Math.round(artifact.score), 0, 100);
  return artifact;
}

async function safe<T>(artifact: UxArtifact, step: string, fn: ()=>Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch (error) {
    artifact.meta.status = artifact.meta.status === 'skipped' ? 'skipped' : 'partial';
    artifact.errors.push({ step, message: error instanceof Error ? error.message : String(error) });
    return fallback;
  }
}

async function getSafeCandidates(page: Page, maxCandidates: number): Promise<Array<{ selector:string; text:string }>> {
  const candidates = await page.evaluate((destructive) => {
    const els = Array.from(document.querySelectorAll('a[href],button,[role="button"],[onclick]')) as HTMLElement[];
    const list: Array<{ selector:string; text:string }> = [];
    for (const el of els) {
      const rect = el.getBoundingClientRect();
      if (rect.width < 12 || rect.height < 12) continue;
      const style = window.getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      const text = ((el.textContent || '') + ' ' + (el.getAttribute('aria-label') || '')).trim().toLowerCase();
      if (!text) continue;
      if (destructive.some((term) => text.includes(term))) continue;
      const id = el.id ? `#${CSS.escape(el.id)}` : '';
      const cls = (el.className && typeof el.className === 'string') ? `.${el.className.trim().split(/\s+/).slice(0,2).map((x)=>CSS.escape(x)).join('.')}` : '';
      list.push({ selector: `${el.tagName.toLowerCase()}${id}${cls}`, text: text.slice(0, 80) });
      if (list.length >= 20) break;
    }
    return list;
  }, DESTRUCTIVE);
  return candidates.slice(0, maxCandidates);
}

async function collectSingle(page: Page, key: string, context: { runId:string; url:string; timestamp:string; browserName:string; viewport:{width:number;height:number} }, outputDir: string, config: AppConfig): Promise<UxArtifact> {
  const started = now();
  const artifact = makeBase(context);
  const tabLimit = config.assuranceModules?.uxSuite?.maxTabSteps ?? 25;
  const clickLimit = config.assuranceModules?.uxSuite?.maxClickCandidates ?? 5;
  const obsWindow = config.assuranceModules?.uxSuite?.observationWindowMs ?? 5000;

  if (key === 'ux-sanity.json') {
    const title = await safe(artifact, 'title', async()=>page.title(), '');
    const status = await safe(artifact, 'status', async()=> page.evaluate(() => (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.responseStatus ?? null), null);
    const text = await safe(artifact, 'text', async()=> page.locator('body').innerText(), '');
    const soft = status === 200 && SOFT_404.some((p)=>text.toLowerCase().includes(p)) && text.length < 2000;
    artifact.signals = { title, status, bodyTextLength: text.length, soft404: soft };
    if (soft) { artifact.meta.status = 'warn'; artifact.score = 65; artifact.topIssues.push({ id:'soft-404', title:'Possible soft 404', severity:'high', description:'Page returned success status but content suggests not found.', evidence:{ status, sample:text.slice(0,120) } }); }
  }

  if (key === 'ux-layout-stability.json') {
    const shifts = await safe(artifact, 'layout', async()=> page.evaluate((windowMs: number)=> new Promise((resolve)=>{
      const out: { total:number; largest:Array<{value:number; ts:number}>; mutations:number } = { total:0, largest:[], mutations:0 };
      const mo = new MutationObserver((list)=> { out.mutations += list.length; });
      mo.observe(document, { subtree:true, childList:true, attributes:true });
      let po: PerformanceObserver | null = null;
      if ('PerformanceObserver' in window) {
        po = new PerformanceObserver((list)=>{
          for (const e of list.getEntries() as Array<PerformanceEntry & { value?: number; hadRecentInput?: boolean }>) {
            if (!e.hadRecentInput) {
              const value = e.value ?? 0;
              out.total += value;
              out.largest.push({ value, ts: e.startTime });
            }
          }
        });
        try { po.observe({ type:'layout-shift', buffered:true }); } catch {}
      }
      setTimeout(()=>{ mo.disconnect(); po?.disconnect(); out.largest.sort((a,b)=>b.value-a.value); resolve({ ...out, largest: out.largest.slice(0,3) }); }, windowMs);
    }), obsWindow), { total:0, largest:[], mutations:0 });
    artifact.signals = shifts as Record<string, unknown>;
    const total = Number((shifts as any).total ?? 0);
    if (total > 0.25) { artifact.meta.status = 'warn'; artifact.score = 60; artifact.topIssues.push({ id:'high-cls', title:'High layout shift', severity:'medium', description:'Layout shifts exceed threshold', evidence:{ total } }); }
  }

  if (key === 'ux-interaction.json') {
    const metrics = await safe(artifact, 'interaction', async()=> page.evaluate(async()=>{
      const longTasks: number[] = [];
      let po: PerformanceObserver | null = null;
      if ('PerformanceObserver' in window) {
        po = new PerformanceObserver((list)=>{ for (const e of list.getEntries()) longTasks.push(e.duration); });
        try { po.observe({ type:'longtask', buffered:true }); } catch {}
      }
      await new Promise((r)=>requestAnimationFrame(()=>r(null)));
      po?.disconnect();
      longTasks.sort((a,b)=>b-a);
      const totalLongTaskMs = longTasks.reduce((s,v)=>s+v,0);
      return { totalLongTaskMs, longTaskCount: longTasks.length, topDurations: longTasks.slice(0,3) };
    }), { totalLongTaskMs:0, longTaskCount:0, topDurations:[] });
    artifact.signals = metrics as Record<string, unknown>;
    if ((metrics as any).totalLongTaskMs > 500) { artifact.meta.status='warn'; artifact.score = 70; artifact.topIssues.push({ id:'long-tasks', title:'Main thread blocked', severity:'medium', description:'Long tasks detected.' }); }
  }

  if (key === 'ux-click-friction.json') {
    const candidates = await safe(artifact, 'candidates', async()=>getSafeCandidates(page, clickLimit), []);
    const results: Array<{ selector:string; reacted:boolean }> = [];
    for (const candidate of candidates) {
      const reacted = await safe(artifact, `click:${candidate.selector}`, async()=> page.evaluate(async (selector) => {
        const beforeHref = location.href;
        const target = document.querySelector(selector) as HTMLElement | null;
        if (!target) return false;
        let mutated = false;
        const mo = new MutationObserver(()=> { mutated = true; });
        mo.observe(document.body, { subtree:true, childList:true, attributes:true });
        target.click();
        await new Promise((r)=>setTimeout(r, 400));
        mo.disconnect();
        return mutated || location.href !== beforeHref || document.activeElement === target;
      }, candidate.selector), false);
      results.push({ selector: candidate.selector, reacted });
    }
    const nonReactingTargets = normalizeUxIssueTargets(results.filter((r)=>!r.reacted).map((r)=>r.selector));
    const dead = nonReactingTargets.length;
    artifact.signals = { candidates, results, deadClicks: dead, nonReactingTargets };
    if (dead > 0) { artifact.meta.status = 'warn'; artifact.score = 100 - dead * 15; artifact.topIssues.push({ id:'dead-click', title:'Potential dead clicks', severity:'medium', description:`${dead} click targets had no reaction.`, targets: nonReactingTargets }); }
  }

  if (key === 'ux-keyboard.json') {
    const trace = await safe(artifact, 'keyboard', async()=> {
      const visited: string[] = [];
      let visibleFocusCount = 0;
      for (let i=0;i<tabLimit;i+=1) {
        await page.keyboard.press('Tab');
        const focus = await page.evaluate(()=> {
          const el = document.activeElement as HTMLElement | null;
          if (!el) return null;
          const style = getComputedStyle(el);
          const visible = style.outlineStyle !== 'none' || style.boxShadow !== 'none';
          const name = el.getAttribute('aria-label') || el.textContent?.trim() || '';
          return { key:`${el.tagName.toLowerCase()}:${name.slice(0,30)}`, visible };
        });
        if (!focus) continue;
        visited.push((focus as any).key);
        if ((focus as any).visible) visibleFocusCount += 1;
      }
      return { visited, unique: new Set(visited).size, visibleFocusPct: visited.length ? (visibleFocusCount / visited.length) * 100 : 0 };
    }, { visited:[], unique:0, visibleFocusPct:0 });
    artifact.signals = trace as Record<string, unknown>;
    if ((trace as any).visibleFocusPct < 70) { artifact.meta.status = 'warn'; artifact.score = 68; artifact.topIssues.push({ id:'focus-visible', title:'Weak focus visibility', severity:'medium', description:'Keyboard focus indicator is often not visible.' }); }
  }

  if (key === 'ux-overlays.json') {
    const overlays = await safe(artifact, 'overlay', async()=> page.evaluate(()=>{
      const vw = window.innerWidth; const vh = window.innerHeight;
      const nodes = Array.from(document.querySelectorAll('body *')) as HTMLElement[];
      const found = nodes.filter((el)=>{
        const style = getComputedStyle(el);
        if (!['fixed','sticky'].includes(style.position)) return false;
        const r = el.getBoundingClientRect();
        return r.width*r.height > vw*vh*0.2;
      }).map((el)=>{ const r=el.getBoundingClientRect(); return { tag:el.tagName.toLowerCase(), coverage:(r.width*r.height)/(vw*vh) }; });
      return { overlayCount: found.length, maxCoverage: found.reduce((m,x)=>Math.max(m,x.coverage),0), overlays: found };
    }), { overlayCount:0, maxCoverage:0, overlays:[] });
    artifact.signals = overlays as Record<string, unknown>;
  }

  if (key === 'ux-readability.json') {
    const readability = await safe(artifact, 'readability', async()=> page.evaluate(()=>{
      const nodes = Array.from(document.querySelectorAll('p,li,span,a,button,h1,h2,h3,h4,h5,h6')) as HTMLElement[];
      let under12 = 0; let under14 = 0;
      for (const n of nodes) { const size = parseFloat(getComputedStyle(n).fontSize); if (size < 12) under12 += 1; if (size < 14) under14 += 1; }
      const total = nodes.length || 1;
      return { nodeCount:nodes.length, under12Pct:(under12/total)*100, under14Pct:(under14/total)*100, lang: document.documentElement.lang || null };
    }), { nodeCount:0, under12Pct:0, under14Pct:0, lang:null });
    artifact.signals = readability as Record<string, unknown>;
  }

  if (key === 'ux-forms.json') {
    const formSignals = await safe(artifact, 'forms', async()=> page.evaluate(()=>{
      const controls = Array.from(document.querySelectorAll('input,select,textarea')) as HTMLElement[];
      if (controls.length === 0 && document.querySelectorAll('form').length === 0) return null;
      let missingName = 0;
      let placeholderOnly = 0;
      for (const c of controls) {
        const el = c as HTMLInputElement;
        const labelled = !!(el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || document.querySelector(`label[for="${el.id}"]`));
        if (!labelled) missingName += 1;
        if (!labelled && !!el.getAttribute('placeholder')) placeholderOnly += 1;
      }
      return { controlCount: controls.length, missingAccessibleName: missingName, placeholderOnlyRate: controls.length ? placeholderOnly/controls.length : 0 };
    }), null);
    if (!formSignals) {
      artifact.meta.status = 'skipped'; artifact.score = null; artifact.signals = { reason:'No forms detected' };
    } else artifact.signals = formSignals as Record<string, unknown>;
  }

  if (key === 'ux-visual-regression.json') {
    const above = path.join(outputDir, 'ux-visual-above-the-fold.png');
    const full = path.join(outputDir, 'ux-visual-fullpage.png');
    await safe(artifact, 'screenshot-above', async()=>page.screenshot({ path: above }), undefined);
    await safe(artifact, 'screenshot-full', async()=>page.screenshot({ path: full, fullPage: true }), undefined);
    const baselinePath = path.join(outputDir, 'ux-visual-baseline.png');
    let baselineFound = fs.existsSync(baselinePath);
    let diffRatio: number | null = null;
    if (baselineFound) {
      const base = fs.readFileSync(baselinePath);
      const cur = fs.readFileSync(above);
      const len = Math.min(base.length, cur.length);
      let diff = Math.abs(base.length - cur.length);
      for (let i=0;i<len;i+=1) if (base[i] !== cur[i]) diff += 1;
      diffRatio = len > 0 ? diff / len : 0;
      artifact.score = Math.max(0, Math.round((1 - diffRatio) * 100));
      if (diffRatio > 0.15) artifact.meta.status = 'warn';
    } else {
      artifact.meta.status = 'skipped'; artifact.score = null;
      artifact.recommendations.push({ title:'Create baseline', detail:'Copy ux-visual-above-the-fold.png to ux-visual-baseline.png for future diff checks.' });
    }
    artifact.signals = { baselineFound, baselinePath: baselineFound ? baselinePath : null, currentPath: above, fullPagePath: full, diffRatio };
  }

  return finalize(artifact, started);
}

export async function collectUxSuite(page: Page, options: { runId:string; url:string; timestamp:string; browserName:string; viewport:{width:number;height:number}; outputDir:string; config: AppConfig }): Promise<void> {
  const files = ['ux-sanity.json','ux-layout-stability.json','ux-interaction.json','ux-click-friction.json','ux-keyboard.json','ux-overlays.json','ux-readability.json','ux-forms.json','ux-visual-regression.json'] as const;
  const out: Record<string, UxArtifact> = {};
  for (const file of files) {
    out[file] = await collectSingle(page, file, options, options.outputDir, options.config);
    writeJson(path.join(options.outputDir, file), out[file]);
  }
  const aggregateIssues = Object.entries(out).flatMap(([file, artifact]) => artifact.topIssues.map((issue)=>({ file, ...issue })));
  const overview: UxArtifact = {
    meta: { ...options, durationMs: Object.values(out).reduce((s,a)=>s+a.meta.durationMs,0), status: aggregateIssues.some((i)=>i.severity==='high') ? 'warn' : 'pass' },
    score: Math.round(Object.values(out).filter((a)=>a.score!==null).reduce((s,a)=>s + (a.score ?? 0), 0) / Math.max(1, Object.values(out).filter((a)=>a.score!==null).length)),
    signals: { artifacts: Object.fromEntries(Object.entries(out).map(([k,v])=>[k,{ status:v.meta.status, score:v.score }])) },
    topIssues: aggregateIssues.slice(0, 25),
    errors: Object.entries(out).flatMap(([file, artifact])=>artifact.errors.map((err)=>({ step:`${file}:${err.step}`, message: err.message }))),
    recommendations: [{ title:'Review UX subtabs', detail:'Use individual UX artifacts for detailed evidence and recommendations.' }]
  };
  writeJson(path.join(options.outputDir, 'ux-overview.json'), overview);
}
