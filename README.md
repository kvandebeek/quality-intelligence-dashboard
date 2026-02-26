# CX Assurance Viewer 2.0 (Playwright Modernization)

Modernized automation/report engine using Playwright + TypeScript. The runner executes target journeys, collects performance, HAR/network insights, and accessibility findings, then exports deterministic JSON artifacts.

## Architecture outline

- `src/cli.ts`: CLI entrypoint.
- `src/config/*`: schema validation + env-aware config loading.
- `src/core/runEngine.ts`: orchestration for browser, targets, and artifact writing.
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

## Environment variables

- `ELASTIC_NODE`
- `ELASTIC_API_KEY`
- `ELASTIC_USERNAME`
- `ELASTIC_PASSWORD`

Use these only when Elasticsearch publishing is enabled.
