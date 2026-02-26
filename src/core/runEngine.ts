import path from 'node:path';
import { chromium, firefox, webkit, type BrowserType } from 'playwright';
import type { AppConfig, RunMetadata, RunSummary, TargetRunArtifacts } from '../models/types.js';
import { compactTimestamp, stableRunId } from '../utils/time.js';
import { ensureDir, writeJson } from '../utils/file.js';
import { collectPerformance } from '../collectors/performanceCollector.js';
import { collectAccessibility } from '../collectors/accessibilityCollector.js';
import { parseHar, recommendNetworkOptimizations } from '../collectors/networkCollector.js';
import { publishToElasticsearch } from '../publishers/elasticsearchPublisher.js';

function browserFactory(name: AppConfig['browser']): BrowserType {
  if (name === 'firefox') return firefox;
  if (name === 'webkit') return webkit;
  return chromium;
}

export async function runAssurance(config: AppConfig): Promise<RunSummary> {
  const timestamp = compactTimestamp();
  const runId = stableRunId(timestamp, config.browser, config.iteration);

  const metadata: RunMetadata = {
    runId,
    timestamp,
    browser: config.browser,
    environment: config.environment,
    iteration: config.iteration,
    targets: config.targets
  };

  const runRoot = path.join(config.outputDir, runId);
  ensureDir(runRoot);
  writeJson(path.join(runRoot, 'run-metadata.json'), metadata);

  const browser = await browserFactory(config.browser).launch({ headless: config.headless });
  const targetArtifacts: TargetRunArtifacts[] = [];
  const outputs: RunSummary['outputs'] = [];

  for (const target of config.targets) {
    const targetFolder = path.join(runRoot, target.name.replace(/\s+/g, '-').toLowerCase());
    ensureDir(targetFolder);
    const harPath = path.join(targetFolder, 'network.har');

    const context = await browser.newContext({ recordHar: { path: harPath, mode: 'full' } });
    const page = await context.newPage();

    await page.goto(target.url, { waitUntil: 'load' });
    if (target.waitForSelector) {
      await page.locator(target.waitForSelector).waitFor({ state: 'visible' });
    }

    const performance = await collectPerformance(page, target.url);
    const accessibility = await collectAccessibility(page, target.url);

    await context.close();

    const requests = parseHar(harPath);
    const recommendations = recommendNetworkOptimizations(requests);

    const artifact: TargetRunArtifacts = {
      target,
      performance,
      network: { harPath: path.relative(runRoot, harPath), requests, recommendations },
      accessibility
    };

    writeJson(path.join(targetFolder, 'performance.json'), performance);
    writeJson(path.join(targetFolder, 'network-requests.json'), requests);
    writeJson(path.join(targetFolder, 'network-recommendations.json'), recommendations);
    writeJson(path.join(targetFolder, 'accessibility.json'), accessibility);
    writeJson(path.join(targetFolder, 'target-summary.json'), artifact);

    outputs.push({
      targetName: target.name,
      folder: path.relative(runRoot, targetFolder),
      files: ['performance.json', 'network-requests.json', 'network-recommendations.json', 'accessibility.json', 'target-summary.json', 'network.har']
    });

    targetArtifacts.push(artifact);
  }

  await browser.close();

  const summary: RunSummary = { metadata, outputs };
  writeJson(path.join(runRoot, 'summary-index.json'), summary);

  await publishToElasticsearch(config.elasticsearch, summary, targetArtifacts);
  return summary;
}
