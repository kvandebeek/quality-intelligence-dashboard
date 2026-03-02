# Quality Signal Hub 2.0

## Run

```bash
npm run run -- --config config/example.config.json
npm run dashboard -- --run <outputDir>/<runId> --port 4173
```

## High-ROI + Governance extension pack

New categories added to dashboard (layout/style unchanged):
- **Reliability & Client Health**: client-side errors, UX friction, memory leaks.
- **Performance Efficiency**: cache analysis.
- **Resilience**: third-party resilience simulation.
- **Governance, Privacy & Security**: privacy/GDPR, runtime security, dependency risk.
- **Regression Intelligence**: regression delta summary.

## Configuration

Use `assuranceModules` in config to enable/disable modules and tune thresholds:
- `assuranceModules.enabled.*` toggles each module.
- `assuranceModules.ux` for rage/dead click thresholds.
- `assuranceModules.memory` for loop count and growth threshold.
- `assuranceModules.thirdPartyResilience` for block mode and blocklist.
- `assuranceModules.privacy` for consent selector hints and tracker domains.
- `assuranceModules.regression` for `watch`/`elevated` thresholds.

Defaults are defined in `src/config/schema.ts`.

## New artifacts

Per target URL folder:
- `client-errors.json`
- `ux-friction.json`
- `memory-leaks.json`
- `cache-analysis.json`
- `cross-browser-performance.json` (desktop Chromium/Firefox/WebKit load-time comparison with 5 iterations each)
- `third-party-resilience.json`
- `privacy-audit.json`
- `runtime-security.json`
- `dependency-risk.json`
- `regression-summary.json` (run summary mirrored into each target folder for per-URL dashboard access)

Run-level root:
- `regression-summary.json`
- `latest-run.json` in output root (`<outputDir>/latest-run.json`) used as previous baseline pointer.

## Regression baseline behavior

- If no prior run pointer exists, regression artifact returns `baseline: "no baseline"` and dashboard shows a graceful no-baseline state.
- After each run, `latest-run.json` is updated to current run path.

## Score interpretation (quick)

- Higher scores are better (`severityScore`, `uxScore`, `cacheScore`, `securityScore`, `dependencyRiskScore`, `resilienceScore`).
- Risk labels are qualitative (`low/medium/high` and `ok/watch/elevated` for regression).

## Known limitations

- Memory leak metrics depend on browser/runtime support (CDP or `performance.memory`).
- Consent detection and tracker classification are heuristic and configurable.
- Third-party failure simulation uses deterministic blocklists/modes and does not infer business-critical intent automatically.

## Traceability

See `TRACEABILITY.md` for artifact -> producer -> dashboard mapping.

## Dashboard theming

- The dashboard now supports `dark` and `light` themes through CSS variable tokens in `src/dashboard/app/app.css`.
- Theme is applied via `document.documentElement.dataset.theme` (`dark` or `light`).
- Selection persistence uses `localStorage["theme"]`.
- Initial theme logic: use saved `theme` if present, otherwise default to `light`.
- To tune colors for either theme, edit the token blocks in `src/dashboard/app/app.css` (`:root` for dark and `:root[data-theme='light']` for light).
