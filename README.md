# Cognizant CX Assurance Viewer 2.0

Enterprise Web Quality Platform built on Playwright + TypeScript strict mode.

## How to run
1. `npm run build`
2. `npm run start` (uses `config/example.config.json`)
3. Run artifacts are generated under `results/<runId>/` with per-URL folders and `index.json`.
4. Launch dashboard: `npm run dashboard -- --run results/<runId>`

## Outputs
- URL artifacts: performance, accessibility, network, recommendations, CWV, security, SEO, visual regression, API monitoring, broken links, third-party risk, stability, memory.
- Run artifacts: `index.json`, `history.json`, `ci-summary.json`, `junit.xml`, `executive-report.pdf`, `normalized-export.json`.

## CI usage
- Consume `ci-summary.json` for quality gates.
- Consume `junit.xml` for CI test reporting.

## Notes
- See `DECISIONS.md` for assumptions/tradeoffs and constrained-environment fallbacks.
- See `REQUIREMENTS_TRACEABILITY.md` for REQ → file/function mapping.
