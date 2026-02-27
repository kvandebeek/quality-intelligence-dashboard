# Quality Signal Hub 2.0 Dashboard

Redesigned artifact-driven dashboard for large test-result sets. The UI is built from folder scanning and lazy section loading (no manually curated URL list).

## Point dashboard to a results root

Run the server against a folder that contains one subfolder per tested URL:

```bash
npm run dashboard -- --run /path/to/results-root --port 4173
```

Then open `http://localhost:4173`.

Expected per-URL artifacts (if present):
- `a11y-beyond-axe.json`
- `accessibility.json`
- `api-monitoring.json`
- `broken-links.json`
- `core-web-vitals.json`
- `lighthouse-summary.json`
- `memory-profile.json`
- `network-recommendations.json`
- `network-requests.json`
- `performance.json`
- `security-scan.json`
- `seo-checks.json`
- `stability.json`
- `target-summary.json`
- `third-party-risk.json`
- `throttled-run.json`
- `visual-current.png`
- `visual-regression.json`

## How indexing works

1. **Startup scan** (`/api/index`):
   - Reads URL subfolders under `--run`.
   - Checks each section file for existence.
   - Parses lightweight summaries for list badges/facets.
   - Tracks parse failures (`parseErrors`) for malformed JSON.
2. **Lazy section load** (`/api/url/:id/section/:name`):
   - Loads only one URL + one section when opened.
   - Returns normalized status (`missing`, `not_available`, `ok`, `issues`, `error`) and raw JSON.
3. **LRU cache**:
   - Parsed JSON is cached by file path with eviction to keep memory bounded.

This keeps the URL list responsive with large folder counts and avoids full eager parsing of heavy files.

## Add a new section in the future

1. Add the new file name to `SECTION_FILES` in `src/dashboard/data.ts`.
2. Extend `normalizeSection()` with summary + state mapping logic.
3. Add a new tab entry in `SECTION_ORDER` in `src/dashboard/app/app.js`.
4. Add a dedicated renderer function and switch case in `loadTab()`.
5. (Optional) wire badge/facet logic if the new section should affect list filtering.

## Build/serve static UI

```bash
npm run dashboard:build
npm run dashboard:serve -- --run /path/to/results-root --port 4173
```


## Logging and diagnostics

### Logging outputs

- Console logs are always enabled in human-readable format.
- Structured JSON logs are written to `./logs/` as `*.jsonl` files.
- Every log includes `runId`, timestamp, app version/build id, and contextual fields.
- Lifecycle events, dataset scans, per-file reads/parses, navigation, section rendering, and slow operations are logged.

### Log level configuration

- Set `LOG_LEVEL` to one of: `DEBUG`, `INFO`, `WARN`, `ERROR`, `FATAL`.
- Default is `INFO` (or `DEBUG` when `NODE_ENV=development`).
- In the UI, click **Verbose logging** to elevate runtime logging to `DEBUG` for the current run.

Example:

```bash
LOG_LEVEL=DEBUG npm run dashboard -- --run /path/to/results-root --port 4173
```

### Export diagnostics

- In the UI, click **Export diagnostics**.
- A ZIP is generated in `logs/diagnostics/` with:
  - log files
  - sanitized environment metadata
  - sanitized runtime config snapshot

### Redaction

Sensitive fields are redacted in logs and diagnostics export, including keys matching:
`token`, `cookie`, `password`, `secret`, `authorization`, `apiKey`, `session`.

See [DIAGNOSTICS.md](./DIAGNOSTICS.md) for field definitions and troubleshooting flow.

## Test Timing & Logging

Test timing is captured during `quality-signal run` execution (the Playwright-based runner in `src/core/runEngine.ts`).
No test-file changes are required.

### What gets measured

- **Per target/test execution**: file, test name, status (`passed|failed|skipped|timedOut`), retry index, start/end timestamps, duration, `isSlow`.
- **Per logical step**: reusable wrapper timing for key pipeline stages (create context/page, navigation, artifact collection, summary write, context close).
- **Suite/run timing**: total start/end, total duration, and pass/fail/skip counts.

### Console output

A line is emitted when each test/target completes:

```text
PASS    1.23s    Start URL (src/core/runEngine.ts)
FAIL    8.91s    Crawled Page 3 (src/core/runEngine.ts)
```

Optional per-step lines are shown when `LOG_TEST_STEPS=true`.

At run end, a summary block prints total duration, test counts, configured slow threshold, and slowest `N` tests.

### JSON artifact

The run writes:

- `artifacts/<runId>/test-timing.json` (when `outputDir` is default `artifacts`)
- otherwise: `<outputDir>/<runId>/test-timing.json`

Example schema:

```json
{
  "runId": "20260227T125011Z-chromium-i1",
  "suite": {
    "startTime": "2026-02-27T12:50:11.114Z",
    "endTime": "2026-02-27T12:50:26.117Z",
    "durationMs": 15003,
    "totalTests": 2,
    "passed": 1,
    "failed": 1,
    "skipped": 0
  },
  "tests": [
    {
      "reference": "src/core/runEngine.ts::Start URL#0",
      "file": "src/core/runEngine.ts",
      "testName": "Start URL",
      "status": "passed",
      "retry": 0,
      "startTime": "2026-02-27T12:50:11.121Z",
      "endTime": "2026-02-27T12:50:15.121Z",
      "durationMs": 4000,
      "isSlow": false,
      "steps": [
        {
          "name": "Navigate to target URL",
          "startTime": "2026-02-27T12:50:11.221Z",
          "endTime": "2026-02-27T12:50:11.721Z",
          "durationMs": 500,
          "parentTestReference": "src/core/runEngine.ts::Start URL#0"
        }
      ]
    }
  ]
}
```

### Environment variables

- `SLOW_TEST_THRESHOLD_MS` (default `5000`)
- `LOG_TEST_STEPS` (default `false`)
- `LOG_SLOWEST_N` (default `10`)

### Extension points

- The JSON model is stable and dashboard-friendly (`runId`, `suite`, `tests`, `steps`).
- Future trend/regression jobs can diff durations by `file + testName` and aggregate over historical runs.

