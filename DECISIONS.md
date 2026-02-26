# DECISIONS

## Dashboard architecture decisions

- **D1 (File reading location):** The dashboard reads artifact JSON on the server-side (Node HTTP server) rather than directly in-browser. This avoids browser filesystem permission complexity and enables simple runtime path selection via CLI/environment across OSes.
- **D2 (HAR parsing default):** `network.har` is detected for presence only and not parsed by default to avoid large-file parse overhead, long startup latency, and memory spikes for local analysis.
- **D3 (Deterministic page discovery):** Page folders are restricted to immediate `page-*` directories and sorted with a stable lexical sort for reproducible ordering.
- **D4 (Validation strategy):** Required JSON files are runtime-validated with zod and fail fast with file-specific error messages to prevent partial/inconsistent dashboard state.
- **D5 (Aggregation determinism):** Run summary “worst pages” rankings sort by metric descending, then URL lexicographically ascending, then original index for deterministic tie-breaking.

## Phase logs and self-check notes

### Phase A
- Implemented dashboard scaffolding (`src/dashboard/*`) with data loading, zod schemas, and CLI sanity command.
- Confirmed parser supports `--run` and `ARTIFACT_RUN_DIR` path selection.
- Self-check: dashboard data pipeline and CLI are runnable.

### Phase B
- Implemented server-rendered UI overview with sorting/filtering controls.
- Added per-page drill-down with accessibility, performance, network tables, and recommendation grouping.
- Self-check: overview and drill-down routes serve complete required data.

### Phase C
- Added run summary route with deterministic aggregated counters and top worst-page lists.
- Added fixture-based parser test and aggregation logic test.
- Updated README + requirement mapping + checklist tracking.
- Self-check: tests validate parsing and run-level aggregation behavior.
