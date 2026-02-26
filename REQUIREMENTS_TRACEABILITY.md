# REQUIREMENTS TRACEABILITY (Dashboard REQD1–REQD25)

| Requirement | Implementation Mapping |
|---|---|
| REQD1 | `src/dashboard/server.ts`, `src/dashboard/data.ts` |
| REQD2 | `src/dashboard/server.ts` (`parseServerOptions`), `src/dashboard/data.ts` (`resolveRunPath`) |
| REQD3 | `src/dashboard/data.ts` (`loadDashboardRun`, `stableSort`) |
| REQD4 | `src/dashboard/data.ts` (`loadDashboardRun`) |
| REQD5 | `src/dashboard/schemas.ts`, `src/dashboard/data.ts` (`parseJsonFile`) |
| REQD6 | `src/dashboard/data.ts` (`toOverviewRows`), `src/dashboard/server.ts` (`renderOverview`) |
| REQD7 | `src/dashboard/server.ts` (`sortRows`, overview sort controls) |
| REQD8 | `src/dashboard/server.ts` (`filterRows`, overview filter controls) |
| REQD9 | `src/dashboard/server.ts` route `/page/:folderName` |
| REQD10 | `src/dashboard/server.ts` (`renderDrilldown`) |
| REQD11 | `src/dashboard/server.ts` (`renderDrilldown` external link) |
| REQD12 | `src/dashboard/data.ts` (`computeRunSummary`), `src/dashboard/server.ts` (`renderRunSummary`) |
| REQD13 | `src/dashboard/data.ts` (`selectWorst`, `computeRunSummary`), `DECISIONS.md` |
| REQD14 | `src/dashboard/*` (local filesystem + HTTP only) |
| REQD15 | `package.json` (no new heavy UI framework deps) |
| REQD16 | `package.json` scripts + Node path handling in `src/dashboard/*` |
| REQD17 | `package.json` script `dashboard` |
| REQD18 | `package.json` script `dashboard:build`, `src/dashboard/build.ts` |
| REQD19 | `package.json` script `dashboard:serve` |
| REQD20 | `src/dashboard/server.ts` CLI/env run-path selection |
| REQD21 | `README.md` Dashboard section |
| REQD22 | `DECISIONS.md` dashboard architecture decisions |
| REQD23 | `REQUIREMENTS_TRACEABILITY.md` |
| REQD24 | `CHECKLIST.md` |
| REQD25 | `tests/dashboardParsing.test.ts`, `tests/dashboardAggregation.test.ts`, `tests/fixtures/dashboard-run/*` |
