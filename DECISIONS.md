# DECISIONS

## Existing artifact structure (P0-1)
- Legacy runs stored URL artifacts directly under a run folder using `page-*` directory names.
- Legacy artifact files observed: `performance.json`, `network-requests.json`, `network-recommendations.json`, `accessibility.json`, `target-summary.json`, and `network.har`.

## Output structure migration (P0-2)
- New runs are written to `results/<runId>/<urlSlug>/` where `urlSlug` is sanitized and hash-suffixed.
- Each URL artifact includes shared metadata fields (`runId`, `url`, `urlSlug`, `timestamp`, `toolVersion`, `schemaVersion`) under `meta`.
- Run aggregate index is emitted at `results/<runId>/index.json`.

## Validation model (P0-3)
- JSON schema files were added in `/schemas/*.schema.json` for every artifact family.
- Runtime validation is enforced using strict zod validators in `src/core/artifactValidation.ts` before each write.

## Normalization model (P0-4)
- A unified normalization layer (`src/core/normalization.ts`) builds a run-wide internal model and computes derived metrics/scoring.
- Formulas are deterministic and documented in code (`computeDerived`, `computeEnterpriseScores`).

## Ambiguous/blocked requirements and assumptions
- Lighthouse integration: package installation is blocked in the current environment (registry policy), so artifacts are generated with `available=false` plus explanatory notes.
- CPU/network throttling: Playwright-only portable alternative currently records explicit unavailability with preserved baseline metrics.
- PDF output: environment constraints prevent adding a PDF generator dependency, so a deterministic placeholder report file is emitted.
- Visual regression: without image-diff libraries, diff ratio is computed via byte-level screenshot comparison as best-effort fallback.
- JUnit output is always generated (`junit.xml`) and treated as the “optional” CI format.
