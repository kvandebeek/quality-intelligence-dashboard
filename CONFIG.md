# Dashboard Scoring Configuration

## Weights
- Performance: 30%
- Accessibility: 20%
- Security: 20%
- Stability: 15%
- SEO: 10%
- Visual: 5%

Defined in `src/dashboard/config.ts` as `CATEGORY_WEIGHTS`.

## Status thresholds
- PASS threshold: overall score >= 80.
- WARN threshold: score below PASS or regressions detected.
- FAIL when blocker exists:
  - CI quality gate fail.
  - Security critical findings.
  - Severe CWV breach.
  - API failure rate and console error blockers.

Defined in `src/dashboard/config.ts` as `SCORE_THRESHOLDS` and `CWV_THRESHOLDS`.

## Notes
Thresholds and weights are intentionally centralized so tuning can happen without touching view logic.
