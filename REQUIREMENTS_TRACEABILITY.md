# REQUIREMENTS TRACEABILITY

## Phase 0
- P0-1 existing artifact documentation → `DECISIONS.md`.
- P0-2 runId + per-run output layout → `src/core/runEngine.ts` (`sanitizeSlug`, `executePipelineForUrl`, `runAssurance`).
- P0-3 artifact schema validation at write → `schemas/*.schema.json`, `src/core/artifactValidation.ts` (`writeValidatedArtifact`).
- P0-4 normalization layer + run index → `src/core/normalization.ts` (`buildRunIndex`, `computeDerived`), `src/core/runEngine.ts` (`index.json` write).

## Phase 1 dashboards/derived metrics
- Executive and comparison metrics source model → `src/core/normalization.ts` (`UnifiedUrlModel` population + derived metrics).
- Dashboard loads normalized run paths and wrapped artifacts → `src/dashboard/data.ts` (`loadDashboardRun`, `unwrapArtifact`).
- Derived metrics formulas (performance/accessibility/backend-frontend/blocking ratio) → `src/core/normalization.ts` (`computeDerived`).

## Phase 2 test modules artifacts
- T1 Core Web Vitals → `src/core/runEngine.ts` (`collectCoreWebVitals`, `core-web-vitals.json`).
- T2 Lighthouse summary artifact → `src/core/runEngine.ts` (`lighthouse-summary.json`).
- T3 Throttled run artifact/degradation → `src/core/runEngine.ts` (`throttled-run.json`).
- T4 Security scanning → `src/core/runEngine.ts` (`security-scan.json`).
- T5 SEO checks → `src/core/runEngine.ts` (`seo-checks.json`).
- T6 Visual regression baseline/diff → `src/core/runEngine.ts` (`visual-regression.json`, `visual-current.png`).
- T8 Broken-link detection → `src/core/runEngine.ts` (`broken-links.json`).
- T9 Third-party risk ranking → `src/core/runEngine.ts` (`third-party-risk.json`).
- T10 Accessibility beyond axe → `src/core/runEngine.ts` (`a11y-beyond-axe.json`).
- T11 Stability testing stats → `src/core/runEngine.ts` (`stability.json`, `computeStats`).
- T12 Memory profiling artifact → `src/core/runEngine.ts` (`memory-profile.json`).

## Phase 3 enterprise features
- E1 configurable scoring model foundation → `src/core/normalization.ts` (`computeEnterpriseScores`).
- E2 baseline/regression support foundation (visual baseline + index comparisons) → `src/core/runEngine.ts`, `src/core/normalization.ts`.
- E3 historical trends artifact → `src/core/runEngine.ts` (`history.json`).
- E4 CI outputs (`ci-summary.json`, `junit.xml`) → `src/core/runEngine.ts`.
- E5 executive PDF artifact placeholder → `src/core/runEngine.ts` (`executive-report.pdf`).
- E6 normalized export → `src/core/runEngine.ts` (`normalized-export.json`).
