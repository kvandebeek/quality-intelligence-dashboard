# Extension Pack Traceability

| Artifact file | Producer (collector/function) | Dashboard view renderer |
|---|---|---|
| `client-errors.json` | `collectClientErrors` in `src/collectors/extensionPackCollector.ts` via `executePipelineForUrl` | `renderClientErrors` in `src/dashboard/app/app.js` |
| `ux-friction.json` | `collectUxFriction` in `src/collectors/extensionPackCollector.ts` | `renderUxFriction` in `src/dashboard/app/app.js` |
| `ux-overview.json` | `collectUxSuite` in `src/collectors/uxSuiteCollector.ts` | `renderUxOverview` in `src/dashboard/app/app.js` |
| `ux-sanity.json` / `ux-layout-stability.json` / `ux-interaction.json` / `ux-click-friction.json` / `ux-keyboard.json` / `ux-overlays.json` / `ux-readability.json` / `ux-forms.json` / `ux-visual-regression.json` | `collectUxSuite` in `src/collectors/uxSuiteCollector.ts` | `renderUxGeneric` in `src/dashboard/app/app.js` |
| `memory-leaks.json` | `collectMemoryLeaks` in `src/collectors/extensionPackCollector.ts` | `renderMemoryLeaks` in `src/dashboard/app/app.js` |
| `cache-analysis.json` | `collectCacheAnalysis` in `src/collectors/extensionPackCollector.ts` | `renderCacheAnalysis` in `src/dashboard/app/app.js` |
| `third-party-resilience.json` | `collectThirdPartyResilience` in `src/collectors/extensionPackCollector.ts` | `renderThirdPartyResilience` in `src/dashboard/app/app.js` |
| `privacy-audit.json` | `collectPrivacyAudit` in `src/collectors/extensionPackCollector.ts` | `renderPrivacyAudit` in `src/dashboard/app/app.js` |
| `runtime-security.json` | `collectRuntimeSecurity` in `src/collectors/extensionPackCollector.ts` | `renderRuntimeSecurity` in `src/dashboard/app/app.js` |
| `dependency-risk.json` | `collectDependencyRisk` in `src/collectors/extensionPackCollector.ts` | `renderDependencyRisk` in `src/dashboard/app/app.js` |
| `regression-summary.json` | `buildRegressionSummary` in `src/core/runEngine.ts` | `renderRegressionSummary` in `src/dashboard/app/app.js` |
