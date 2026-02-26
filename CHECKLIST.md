# CHECKLIST

## Dashboard REQD1–REQD25 Status

| REQ ID | Status | Notes |
|---|---|---|
| REQD1 | Done | Added local TypeScript dashboard server + data loader. |
| REQD2 | Done | Run folder accepted from `--run` or `ARTIFACT_RUN_DIR`. |
| REQD3 | Done | `page-*` discovery uses deterministic stable sort. |
| REQD4 | Done | Required JSON files loaded; HAR existence detected only. |
| REQD5 | Done | Zod runtime validation with file-specific fail-fast errors. |
| REQD6 | Done | Overview table includes URL, a11y/perf/network/recommendation metrics. |
| REQD7 | Done | Default URL sort and selectable column sorting supported. |
| REQD8 | Done | URL search, critical/serious, load threshold, and failure filters implemented. |
| REQD9 | Done | Drill-down route at `/page/:folderName`. |
| REQD10 | Done | Drill-down includes required sections/tables and network controls. |
| REQD11 | Done | Drill-down includes external “Open URL” link. |
| REQD12 | Done | Run Summary route includes totals and worst-page lists. |
| REQD13 | Done | Deterministic aggregation/tiebreak rules documented. |
| REQD14 | Done | No cloud/Elasticsearch dependency required for dashboard. |
| REQD15 | Done | Minimal dependencies retained (Node + existing zod). |
| REQD16 | Done | Node LTS-compatible scripts and platform-safe path resolution. |
| REQD17 | Done | Added `npm run dashboard`. |
| REQD18 | Done | Added `npm run dashboard:build`. |
| REQD19 | Done | Added `npm run dashboard:serve`. |
| REQD20 | Done | Run folder can be changed at startup via arg/env without rebuild. |
| REQD21 | Done | README Dashboard section added. |
| REQD22 | Done | DECISIONS updated for file reading and HAR behavior. |
| REQD23 | Done | REQD traceability matrix updated. |
| REQD24 | Done | This checklist tracks REQD1–REQD25. |
| REQD25 | Done | Added parsing fixture test + summary aggregation test. |

## Phase A self-check
- Scaffolded dashboard modules and CLI summary utility.
- Implemented run folder discovery, JSON loading, and zod validation.
- Confirmed runnable parsing path via `npm run dashboard:cli`.

## Phase B self-check
- Implemented overview page with sorting/filtering and drill-down route.
- Implemented required drill-down data tables and grouped recommendations.
- Confirmed dashboard server runs and serves HTML UI.

## Phase C self-check
- Implemented run-level summary route with deterministic worst-page rankings.
- Added fixtures and automated tests for parsing + aggregation logic.
- Updated README, decisions, and traceability documentation.
