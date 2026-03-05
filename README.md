# Quality Signal Hub 2.0

## CLI quickstart

For full command and option documentation, see [docs/cli.md](docs/cli.md).

```bash
# Run tests with a config
npm run run -- --config config/example.config.json

# Start dashboard for a specific run folder
npm run dashboard -- --run artifacts/<runId> --port 4173

# Interactive config picker
npm run runs

# Interactive run picker
npm run dashboards
```

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

Artifacts are isolated per batch target under the batch item's `name` folder:

```text
<outputDir>/<batchItem.name>/<runId>/...
```

`batchItem.name` is sanitized for cross-platform filesystem safety (`<>:"/\|?*` and control chars are replaced with `_`, underscores are collapsed, whitespace is trimmed). If the sanitized name becomes empty, the folder falls back to `unknown-<hostname>` derived from `startUrl`.

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
- **Reliability & Client Health**: client-side errors and memory leaks.
- **Governance, Privacy & Security**: privacy/GDPR, runtime security, dependency risk.
- **Regression Intelligence**: regression delta summary.

## Configuration

Use `assuranceModules` in config to enable/disable modules and tune thresholds:
- `assuranceModules.enabled.*` toggles each module.
- `assuranceModules.uxSuite` for generic UX suite bounds (`maxClickCandidates`, `maxTabSteps`, `observationWindowMs`).
- `assuranceModules.memory` for loop count and growth threshold.
- `assuranceModules.privacy` for consent selector hints and tracker domains.
- `assuranceModules.regression` for `watch`/`elevated` thresholds.

Defaults are defined in `src/config/schema.ts`.


## Cross-browser performance (optional)

`cross-browser-performance` compares desktop load time across Chromium, Firefox, and WebKit using repeated navigations (default: 5 runs per browser).

This feature is opt-in via `config/features.json`. If the file is missing, the collector is treated as disabled and artifacts are written as `untested`.

Example:

```json
{
  "enabled": true,
  "browsers": ["chromium", "firefox", "webkit"],
  "runs": 5,
  "navigationTimeoutMs": 30000,
  "cooldownMs": 0,
  "skipIfHeadless": false
}
```

Untested reasons shown in artifacts/dashboard:
- `missing_config`
- `disabled`
- `invalid_config`
- `skipped_headless`
- `no_browsers_configured`

## New artifacts

Per target URL folder:
- `client-errors.json`
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
- `cross-browser-performance.json` (desktop Chromium/Firefox/WebKit load-time comparison with 5 iterations each)
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

- Higher scores are better (`severityScore`, `uxScore`, `cacheScore`, `securityScore`, `dependencyRiskScore`).
- Risk labels are qualitative (`low/medium/high` and `ok/watch/elevated` for regression).

## Known limitations

- Memory leak metrics depend on browser/runtime support (CDP or `performance.memory`).
- Consent detection and tracker classification are heuristic and configurable.

## Traceability

See `TRACEABILITY.md` for artifact -> producer -> dashboard mapping.


## Domain overview landing dashboard

The dashboard now opens on **Domain overview** by default, with a dedicated navbar item above URL rows.

This view aggregates results across all checked URLs and renders 8 tiles:
- Accessibility issues by severity (critical/serious/moderate/minor)
- Content load FCP (domain average, min, max)
- Broken links (broken + total + coverage)
- SEO score (domain average, min, max)
- Core Web Vitals status by metric (distribution + LCP/INP/CLS Good rates)
- Client-side errors (total errors + affected URLs)
- Security findings by severity (explicitly distinguishes `No security findings` from `Not collected`)
- UI/UX checks summary (pass/fail page counts + top recurring issues)

All tiles include per-metric coverage (e.g., measured URLs / total URLs).

`Not collected` means the corresponding collector was disabled, artifact files are missing, or usable metric fields were not produced for that run.

## Dashboard theming

- The dashboard now supports `dark` and `light` themes through CSS variable tokens in `src/dashboard/app/app.css`.
- Theme is applied via `document.documentElement.dataset.theme` (`dark` or `light`).
- Selection persistence uses `localStorage["theme"]`.
- Initial theme logic: use saved `theme` if present, otherwise default to `light`.
- To tune colors for either theme, edit the token blocks in `src/dashboard/app/app.css` (`:root` for dark and `:root[data-theme='light']` for light).

## a11y-beyond-axe details (focus trap + contrast simulation)

`a11y-beyond-axe.json` now includes structured diagnostics that remain backward compatible:

- `possibleFocusTrapDetails.candidates[]`: suspected trap selector, role/ARIA summary, visibility/enabled state, bounding box, tab sequence evidence, repeat pattern, repro text, and screenshot path.
- `contrastSimulationDetails.method`: deterministic sampling metadata (viewport + scroll positions + what is measured).
- `contrastSimulationDetails.findings[]`: per-sample screenshot references, measured regions with bounding boxes/region scores/reasons, and targeted recommendations.

Artifacts are written under `<target-folder>/a11y-beyond-axe/` so evidence is run-scoped and deterministic.
