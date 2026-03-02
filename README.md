# Quality Signal Hub 2.0

## Run

```bash
npm run run -- --config config/example.config.json
npm run dashboard -- --run <outputDir>/<runId> --port 4173
```

## Batch runs

Existing single-config usage remains unchanged:

```bash
npm run run -- --config config/example.config.json
```

You can also execute multiple targets in one invocation:

```bash
npm run run -- --config batch-test.json
```

Batch config format:
- `defaults` is optional and supplies shared values (`browser`, `headless`, `environment`, `iteration`, `outputDir`, `elasticsearch`, etc.).
- Each item in `batch[]` must define `name`, `startUrl`, and `crawl`.
- Per-item values override `defaults` for `name`, `startUrl`, and `crawl`.

Artifacts are isolated per batch target under:

```text
<outputDir>/batch/<index>_<sanitizedName>_<sanitizedHost>/<runId>/...
```

Example (`batch-test.json`):

```json
{
  "defaults": {
    "browser": "chromium",
    "headless": true,
    "environment": "local",
    "iteration": 1,
    "outputDir": "artifacts",
    "elasticsearch": { "enabled": false, "indexPrefix": "quality-signal" }
  },
  "batch": [
    {
      "name": "RESILLION",
      "startUrl": "https://www.resillion.com",
      "crawl": {
        "enabled": true,
        "maxDepth": 3,
        "maxPages": 10,
        "includeExternalDomains": false,
        "allowedDomains": ["resillion.com"]
      }
    }
  ]
}
```

## High-ROI + Governance extension pack

New categories added to dashboard (layout/style unchanged):
- **UX**: generic site-agnostic UX checks (sanity, layout stability, interaction, dead-click friction, keyboard, overlays, readability, forms, visual snapshots).
- **Reliability & Client Health**: client-side errors, UX friction, memory leaks.
- **Performance Efficiency**: cache analysis.
- **Resilience**: third-party resilience simulation.
- **Governance, Privacy & Security**: privacy/GDPR, runtime security, dependency risk.
- **Regression Intelligence**: regression delta summary.

## Configuration

Use `assuranceModules` in config to enable/disable modules and tune thresholds:
- `assuranceModules.enabled.*` toggles each module.
- `assuranceModules.ux` for legacy UX friction thresholds.
- `assuranceModules.uxSuite` for generic UX suite bounds (`maxClickCandidates`, `maxTabSteps`, `observationWindowMs`).
- `assuranceModules.memory` for loop count and growth threshold.
- `assuranceModules.thirdPartyResilience` for block mode and blocklist.
- `assuranceModules.privacy` for consent selector hints and tracker domains.
- `assuranceModules.regression` for `watch`/`elevated` thresholds.

Defaults are defined in `src/config/schema.ts`.

## New artifacts

Per target URL folder:
- `client-errors.json`
- `ux-friction.json`
- `ux-overview.json`
- `ux-sanity.json`
- `ux-layout-stability.json`
- `ux-interaction.json`
- `ux-click-friction.json`
- `ux-keyboard.json`
- `ux-overlays.json`
- `ux-readability.json`
- `ux-forms.json`
- `ux-visual-regression.json` (plus `ux-visual-above-the-fold.png` and `ux-visual-fullpage.png`)
- `memory-leaks.json`
- `cache-analysis.json`
- `cross-browser-performance.json` (desktop Chromium/Firefox/WebKit load-time comparison with 5 iterations each)
- `third-party-resilience.json`
- `privacy-audit.json`
- `runtime-security.json`
- `dependency-risk.json`
- `regression-summary.json` (run summary mirrored into each target folder for per-URL dashboard access)
- `seo-score.json` (deterministic SEO score v1 with category subscores and per-check transparency)

Run-level root:
- `regression-summary.json`
- `latest-run.json` in output root (`<outputDir>/latest-run.json`) used as previous baseline pointer.


## SEO-score (v1 heuristic)

The dashboard SEO section now includes **SEO-score**, a deterministic 0–100 score computed from measurable technical/on-page signals already collected by this tool (no paid backlink APIs required).

Categories and weights:
- **Indexability & Crawlability (30%)**
- **On-page Metadata & Semantics (30%)**
- **Content & Link Hygiene (20%)**
- **Performance proxy (20%)**

Notes:
- Missing checks are marked `not_measured` and are **excluded from weighting** via per-URL re-normalization.
- Thresholds/weights are centralized in `src/collectors/seoScore/seoScoreConstants.ts`.
- SEO-score is heuristic and does not include backlink/authority signals unless future optional adapters are added.

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


## Domain overview landing dashboard

The dashboard now opens on **Domain overview** by default, with a dedicated navbar item above URL rows.

This view aggregates results across all checked URLs and renders 8 tiles:
- Accessibility issues by severity (critical/serious/moderate/minor)
- Content load FCP (domain average, min, max)
- Broken links (broken + total + coverage)
- SEO score (domain average, min, max)
- Core Web Vitals pass-rate split (Good / Needs improvement / Poor)
- Client-side errors (total errors + affected URLs)
- Security findings by severity
- Visual regression summary (changed URLs, avg diff ratio, baseline coverage)

All tiles include per-metric coverage (e.g., measured URLs / total URLs) and gracefully show “Not measured” when artifacts are missing or null.

## Dashboard theming

- The dashboard now supports `dark` and `light` themes through CSS variable tokens in `src/dashboard/app/app.css`.
- Theme is applied via `document.documentElement.dataset.theme` (`dark` or `light`).
- Selection persistence uses `localStorage["theme"]`.
- Initial theme logic: use saved `theme` if present, otherwise default to `light`.
- To tune colors for either theme, edit the token blocks in `src/dashboard/app/app.css` (`:root` for dark and `:root[data-theme='light']` for light).
