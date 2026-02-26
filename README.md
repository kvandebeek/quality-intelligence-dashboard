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
