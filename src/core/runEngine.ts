import path from 'node:path';
import { createHash } from 'node:crypto';
import { chromium, firefox, webkit, type BrowserType, type Page } from 'playwright';
import type {
  AppConfig,
  CrawlPageMetadata,
  RunMetadata,
  RunSummary,
  RunTarget,
  TargetRunArtifacts
} from '../models/types.js';
import { compactTimestamp, stableRunId } from '../utils/time.js';
import { ensureDir, writeJson } from '../utils/file.js';
import { collectPerformance } from '../collectors/performanceCollector.js';
import { collectAccessibility } from '../collectors/accessibilityCollector.js';
import { parseHar, recommendNetworkOptimizations } from '../collectors/networkCollector.js';
import { publishToElasticsearch } from '../publishers/elasticsearchPublisher.js';
import { extractAnchorHrefs, runBfsCrawl } from './crawler.js';

const ARTIFACT_FILES = [
  'performance.json',
  'network-requests.json',
  'network-recommendations.json',
  'accessibility.json',
  'target-summary.json',
  'network.har'
] as const;

function browserFactory(name: AppConfig['browser']): BrowserType {
  if (name === 'firefox') return firefox;
  if (name === 'webkit') return webkit;
  return chromium;
}

function urlSegment(url: string): string {
  const value = new URL(url);
  const slug = `${value.hostname}${value.pathname}`.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
  const hash = createHash('sha1').update(url).digest('hex').slice(0, 8);
  return `${slug || 'root'}-${hash}`;
}

function folderName(index: number, url: string): string {
  return `page-${String(index + 1).padStart(4, '0')}-${urlSegment(url)}`;
}

async function scrapePageLinks(page: Page): Promise<string[]> {
  const hrefs = await page.locator('a[href]').evaluateAll((anchors) =>
    anchors.map((anchor) => anchor.getAttribute('href'))
  );
  return extractAnchorHrefs(hrefs);
}

async function executePipelineForUrl(
  browser: Awaited<ReturnType<BrowserType['launch']>>,
  runRoot: string,
  target: RunTarget,
  index: number,
  crawl: CrawlPageMetadata | undefined
): Promise<{ artifact: TargetRunArtifacts; output: RunSummary['outputs'][number]; hrefs: string[] }> {
  const targetFolder = path.join(runRoot, folderName(index, target.url));
  ensureDir(targetFolder);
  const harPath = path.join(targetFolder, 'network.har');

  const context = await browser.newContext({ recordHar: { path: harPath, mode: 'full' } });
  const page = await context.newPage();

  await page.goto(target.url, { waitUntil: 'load' });
  if (target.waitForSelector) {
    await page.locator(target.waitForSelector).waitFor({ state: 'visible' });
  }

  const [performance, accessibility, hrefs] = await Promise.all([
    collectPerformance(page, target.url),
    collectAccessibility(page, target.url),
    scrapePageLinks(page)
  ]);

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

  return {
    artifact,
    output: {
      targetName: target.name,
      folder: path.relative(runRoot, targetFolder),
      files: [...ARTIFACT_FILES],
      crawl
    },
    hrefs
  };
}

function resolveLinearTargets(config: AppConfig): RunTarget[] {
  if (config.targets.length > 0) {
    return config.targets;
  }

  return [{ name: 'Start URL', url: config.startUrl }];
}

export async function runAssurance(config: AppConfig): Promise<RunSummary> {
  const timestamp = compactTimestamp();
  const runId = stableRunId(timestamp, config.browser, config.iteration, config.name);

  const metadata: RunMetadata = {
    runId,
    timestamp,
    browser: config.browser,
    environment: config.environment,
    iteration: config.iteration,
    name: config.name,
    startUrl: config.startUrl,
    targets: config.targets
  };

  const runRoot = path.join(config.outputDir, runId);
  ensureDir(runRoot);
  writeJson(path.join(runRoot, 'run-metadata.json'), metadata);

  const browser = await browserFactory(config.browser).launch({ headless: config.headless });
  const targetArtifacts: TargetRunArtifacts[] = [];
  const outputs: RunSummary['outputs'] = [];

  if (config.crawl.enabled) {
    const crawlResult = await runBfsCrawl(
      {
        startUrl: config.startUrl,
        crawlConfig: config.crawl
      },
      async ({ url, parentUrl, depth, index }) => {
        const crawlMetadata: CrawlPageMetadata = { url, parentUrl, depth };
        const executed = await executePipelineForUrl(
          browser,
          runRoot,
          { name: `Crawled Page ${index + 1}`, url },
          index,
          crawlMetadata
        );

        targetArtifacts.push(executed.artifact);
        outputs.push(executed.output);

        return { discoveredHrefs: executed.hrefs };
      }
    );

    await browser.close();

    const summary: RunSummary = {
      metadata,
      outputs,
      crawl: {
        totalPagesDiscovered: crawlResult.totalPagesDiscovered,
        totalPagesExecuted: crawlResult.totalPagesExecuted,
        pages: crawlResult.executedPages,
        skippedUrls: crawlResult.skippedUrls
      }
    };

    writeJson(path.join(runRoot, 'summary-index.json'), summary);
    await publishToElasticsearch(config.elasticsearch, summary, targetArtifacts);
    return summary;
  }

  const targets = resolveLinearTargets(config);
  for (const [index, target] of targets.entries()) {
    const executed = await executePipelineForUrl(browser, runRoot, target, index, undefined);
    outputs.push(executed.output);
    targetArtifacts.push(executed.artifact);
  }

  await browser.close();

  const summary: RunSummary = { metadata, outputs };
  writeJson(path.join(runRoot, 'summary-index.json'), summary);

  await publishToElasticsearch(config.elasticsearch, summary, targetArtifacts);
  return summary;
}
