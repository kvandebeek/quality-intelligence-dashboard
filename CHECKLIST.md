# CHECKLIST

## Phase 0 — Foundations
- [x] P0-1 documented legacy artifact structure in `DECISIONS.md`.
- [x] P0-2 introduced runId + `results/<runId>/<urlSlug>/` output contract in engine.
- [x] P0-3 added schema folder and write-time validation layer.
- [x] P0-4 added normalization layer and run-level `index.json` generation.

Self-check: PASS (build validation + artifact model wiring complete).

## Phase 1 — Dashboards from normalized artifacts
- [x] Dashboard data-loader handles normalized/wrapped artifacts.
- [x] Derived metrics implemented in normalization layer.
- [x] Cross-URL rankings generated in run index summary.

Self-check: PASS (data pipeline deterministic and traceable).

## Phase 2 — New test modules
- [x] T1 Core Web Vitals artifact.
- [x] T2 Lighthouse summary artifact (fallback in constrained env).
- [x] T3 Throttled-run artifact (fallback in constrained env).
- [x] T4 Security scan artifact.
- [x] T5 SEO score artifact.
- [x] T6 Visual regression artifact + baseline handling.
- [x] T7 API monitoring artifact.
- [x] T8 Broken-link artifact.
- [x] T9 Third-party risk artifact.
- [x] T10 Accessibility-beyond-axe artifact.
- [x] T11 Stability artifact.
- [x] T12 Memory profile artifact.

Self-check: PASS with documented environment limitations in `DECISIONS.md`.

## Phase 3 — Enterprise features
- [x] E1 Enterprise scoring output.
- [x] E2 Baseline/regression foundation.
- [x] E3 Historical trends artifact.
- [x] E4 CI summary + JUnit output.
- [x] E5 Executive report artifact.
- [x] E6 Normalized export artifact.

Self-check: PASS (outputs emitted per-run).
