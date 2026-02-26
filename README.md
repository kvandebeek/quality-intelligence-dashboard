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

## Dashboard

A local artifacts dashboard is included for browsing existing run outputs without Elasticsearch/cloud services.

### Start dashboard against a run folder

Use either a CLI argument (preferred) or environment variable:

```bash
npm run dashboard -- --run artifacts/<run-id>
# or
ARTIFACT_RUN_DIR=artifacts/<run-id> npm run dashboard
```

Then open `http://localhost:4173`.

### Build and serve

```bash
npm run dashboard:build
node dist/dashboard/server.js --run artifacts/<run-id> --port 4173
# or
ARTIFACT_RUN_DIR=artifacts/<run-id> npm run dashboard:serve
```

### Dashboard views

- **Overview (`/`)**: one row per URL with accessibility counters, performance metrics (TTFB/DCL/load/resource transfer/count), network summary, recommendation counts, sorting, and filters.
- **Drill-down (`/page/:folder`)**: URL/page-folder header, accessibility issues table, performance summary, network request table (status-class filter + duration/transfer sorting), grouped recommendations, and “Open URL” link.
- **Run Summary (`/summary`)**: total pages, aggregated accessibility counters, and deterministic worst pages by load event, critical a11y count, and transfer size.

### Notes and limitations

- The dashboard reads required JSON files from each `page-*` directory and validates shape at runtime.
- `network.har` is treated as optional metadata and **is not parsed by default**.
- You can point to different run folders at startup via `--run` or `ARTIFACT_RUN_DIR` without rebuilding the dashboard.


## Layout system

The dashboard now includes a reusable layout skeleton designed for a Resillion-like structure while keeping existing data handling intact.

### Theme tokens

- `src/dashboard/styles/tokens.css` defines CSS variables for color palette, spacing, radius, shadows, gradients, and typography.
- Update these variables to re-theme header/nav/cards/panels globally.

### Main layout classes

- Section/background modifiers: `page-block`, `purple-bg`, `white-bg`, `purple-light-bg`, `gradient-bg`, `second-half-gradient`.
- Header/nav patterns: `site-header`, `header-layout`, `main-menu`, `menu-item`, `has-sub-menu`, `sub-menu`, `mobile-nav`, `mobile-nav-toggle`, `buttons-block`.
- Layout primitives: `container`, `row`, `col-*`, `d-flex`, `align-items-center`, `align-items-stretch`, `text-center`, `mx-auto`, `w-100`.
- UI primitives: `btn`, `btn-slide`, `btn-fade`, `card`, `panel` (+ header/body/footer helpers).

### Extending the layout

- Add new dashboard sections by composing `panel` and `card` blocks inside the existing `dashboard-grid`.
- Keep URL selection wiring through `selectedUrlId` query state so cards and detail panel stay synchronized.
- For responsive behavior, follow the breakpoints in `src/dashboard/styles/dashboard-layout.css` (`1024px` for detail drawer, `768px` for mobile left-nav behavior).

### How to run dashboard layout locally

```bash
npm run dashboard -- --run tests/fixtures/dashboard-run
```

Then open `http://localhost:4173`.
