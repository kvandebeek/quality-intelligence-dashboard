# CX Assurance Viewer 2.0 (Playwright Modernization)

Modernized automation/report engine using Playwright + TypeScript. The runner executes target journeys or recursive crawl journeys, collects performance, HAR/network insights, and accessibility findings, then exports deterministic JSON artifacts.

## Architecture outline

- `src/cli.ts`: CLI entrypoint.
- `src/config/*`: schema validation + env-aware config loading.
- `src/core/runEngine.ts`: orchestration for browser, targets/crawl pages, and artifact writing.
- `src/core/crawler.ts`: deterministic same-domain BFS crawling module.
- `src/collectors/*`: performance/network/accessibility collectors.
- `src/publishers/elasticsearchPublisher.ts`: optional Elasticsearch publishing path.
- `src/models/types.ts`: strict data model contracts.

## How to run

1. Install dependencies:
   ```bash
   npm ci
   npx playwright install chromium
   ```
2. Run with sample config:
   ```bash
   npm run run -- --config config/example.config.json
   ```
3. Artifacts will be written under `artifacts/<run-id>/`.

## Crawl configuration

`startUrl` and `crawl` fields are validated at startup; invalid values fail fast.

```json
{
  "startUrl": "https://example.com",
  "crawl": {
    "enabled": true,
    "maxDepth": 2,
    "maxPages": 50,
    "includeExternalDomains": false,
    "allowedDomains": ["example.com"]
  }
}
```

Field guidance:

- `startUrl`: crawl entry URL and fallback target URL when `targets` is empty.
- `crawl.enabled`: enables recursive BFS crawling.
- `crawl.maxDepth`: maximum link depth from `startUrl` (`startUrl` depth = 0).
- `crawl.maxPages`: hard execution cap across crawled pages.
- `crawl.includeExternalDomains`: if true, cross-domain crawling is allowed.
- `crawl.allowedDomains`: explicit host allowlist when external domains are disabled.

## Deterministic crawl behavior

- Queue-based BFS traversal.
- URL normalization (absolute resolution + fragment removal).
- Deterministic lexicographic child ordering before enqueue.
- Duplicate URL prevention with visited set.
- Deterministic artifact folder names: `page-<index>-<slug>-<hash>`.
- Summary includes crawl lineage, totals, and skipped URL reasons.

## Environment variables

- `ELASTIC_NODE`
- `ELASTIC_API_KEY`
- `ELASTIC_USERNAME`
- `ELASTIC_PASSWORD`

Use these only when Elasticsearch publishing is enabled.
