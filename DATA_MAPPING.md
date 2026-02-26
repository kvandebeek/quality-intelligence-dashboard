# Data Mapping

## Global views
- Overview/Portfolio: `index.json`, `summary-index.json`, `run-metadata.json`, `history.json`, `ci-summary.json`.
- Trends: `history.json` (if missing, section shows unavailable state).
- CI Health: `ci-summary.json` and optional `junit.xml` presence signal.

## URL Detail sections
- Executive: `target-summary.json`, `lighthouse-summary.json`, merged recommendations from available artifacts.
- Performance: `performance.json`, `core-web-vitals.json`, `throttled-run.json`, `memory-profile.json`, `network-requests.json`.
- Accessibility: `accessibility.json`, `a11y-beyond-axe.json`.
- Security: `security-scan.json`, `third-party-risk.json`.
- Network: `network-recommendations.json`, `network-requests.json`.
- Stability: `stability.json`, `broken-links.json`, `api-monitoring.json`.
- SEO: `seo-checks.json`.
- Visual: `visual-regression.json`, `visual-current.png` and any discovered images.

## Fallbacks/derivations
- Missing category scores derive proxies from issue counts, timings, and risk counts.
- Missing artifact values render "Not available".
- Validation logs include found/missing artifacts per URL folder and global scope.
