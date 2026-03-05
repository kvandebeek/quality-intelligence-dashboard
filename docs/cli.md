# CLI Reference

This document is the authoritative command-line reference for running test executions (`run`/`runs`) and opening artifacts in the dashboard (`dashboard`/`dashboards`).

## A. Commands overview

### 1) Run tests (non-interactive)
- **Purpose:** Execute a single-run or batch-run config file.
- **Canonical invocation:** `npm run run -- --config <path-to-json>`
- **Direct entrypoint:** `tsx src/cli.ts run --config <path-to-json>`
- **Example (Windows PowerShell):** `npm run run -- --config .\config\example.config.json`
- **Example (batch):** `npm run run -- --config .\batch-test.json`

### 2) Run tests (interactive config picker)
- **Purpose:** Discover config files in `config/`, optionally pick one interactively, then delegate to `npm run run -- --config ...`.
- **Canonical invocation:** `npm run runs`
- **Optional non-interactive form:** `npm run runs -- --config <path-to-json>`
- **Direct entrypoint:** `node --import tsx src/run/launcher.ts [options]`
- **Example:** `npm run runs -- --list`

### 3) Start dashboard server (non-interactive)
- **Purpose:** Start the dashboard HTTP server for a specific run folder (or default run path resolution).
- **Canonical invocation:** `npm run dashboard -- --run <run-folder> [--port <number>]`
- **Direct entrypoint:** `tsx src/dashboard/server.ts [options]`
- **Example (Windows PowerShell):** `npm run dashboard -- --run .\artifacts\my-run-id --port 4173`

### 4) Start dashboard (interactive run picker)
- **Purpose:** List run folders from artifacts, pick one interactively, start server, and open browser.
- **Canonical invocation:** `npm run dashboards`
- **Optional non-interactive form:** `npm run dashboards -- --run <run-folder> [--port <number>]`
- **Direct entrypoint:** `tsx src/dashboard/dashboards.ts [options]`
- **Example:** `npm run dashboards -- --list`

---

## B. Options table per command

## `npm run run -- ...`

| Option | Type | Default | Required | Valid values / constraints | Description | Notes |
|---|---|---|---|---|---|---|
| `-c, --config <path>` | string | none | yes | Any readable JSON file path, relative or absolute | Path to run config file | Supports single-run config (`startUrl`) and batch config (`batch[]`). |
| `-h, --help` | boolean | false | no | n/a | Show help text | Provided by Commander. Exits with status `0`. |

## `npm run runs` (interactive config selector)

| Option | Type | Default | Required | Valid values / constraints | Description | Notes |
|---|---|---|---|---|---|---|
| `--config <path>` | string | none | no | Any existing JSON file path, relative or absolute | Skip interactive picker and launch `npm run run -- --config <path>` | Path is normalized against repo root when relative. |
| `--list` | boolean | false | no | n/a | List discoverable config files and exit | Discovery prefers `*.config.json`; falls back to `*.json` when none match. |
| `-h, --help` | boolean | false | no | n/a | Show usage text | Exits with status `0`. |

## `npm run dashboard -- ...`

| Option | Type | Default | Required | Valid values / constraints | Description | Notes |
|---|---|---|---|---|---|---|
| `--run <path>` | string | `ARTIFACT_RUN_DIR` env if set; otherwise current working directory | no | Any path (resolved absolute) | Run directory to render in dashboard | CLI value overrides `ARTIFACT_RUN_DIR`. |
| `--port <number>` | number | `4173` | no | Finite number > 0 | TCP port for server | Invalid values throw and exit non-zero. |
| `--static` | boolean | false | no | n/a | Serve static assets from `dist/dashboard` | Mainly for built dashboard assets. |
| `-h, --help` | boolean | false | no | n/a | Show usage text | Exits with status `0`. |

## `npm run dashboards` (interactive run selector)

| Option | Type | Default | Required | Valid values / constraints | Description | Notes |
|---|---|---|---|---|---|---|
| `--artifacts-dir <path>` | string | `./artifacts` | no | Existing directory path | Root containing run folders | Used for discovery and interactive list. |
| `--run <path>` | string | none | no | Existing run directory | Skip interactive picker and start dashboard for that run | Useful for CI / scripted use. |
| `--port <number>` | number | `4173` | no | Finite number > 0 | TCP port for server | Passed to underlying dashboard server startup. |
| `--list` | boolean | false | no | n/a | List available run folders and exit | Sorted by latest modified first. |
| `--no-open` | boolean | false | no | n/a | Do not auto-open browser | Keeps process in terminal only. |
| `-h, --help` | boolean | false | no | n/a | Show usage text | Exits with status `0`. |

---

## Environment variables

These environment variables materially affect runtime behavior for run/dashboard flows.

### Run-related
- `ELASTIC_NODE`: Overrides `elasticsearch.node` from config.
- `ELASTIC_API_KEY`: Overrides `elasticsearch.apiKey` from config.
- `ELASTIC_USERNAME`: Overrides `elasticsearch.username` from config.
- `ELASTIC_PASSWORD`: Overrides `elasticsearch.password` from config.

### Dashboard-related
- `ARTIFACT_RUN_DIR`: Default run directory for `dashboard` when `--run` is not supplied.
- `LOG_LEVEL`: Influences dashboard server logging verbosity.
- `BUILD_ID`: Included in diagnostics/log context metadata.

---

## C. Config file support (`--config`)

### Expected path format
- Relative paths are supported and resolved from current working directory (`run`) or repository root (`runs --config`).
- Absolute paths are supported.

### Discovery behavior for interactive launcher (`npm run runs`)
- Scans `<repoRoot>/config`.
- If one or more files match `*.config.json`, only those are listed.
- If none match, falls back to all `*.json` files in `config/`.

### Merge/override rules
- For `run`: there are no per-field CLI overrides besides selecting config path. Runtime values come from file + environment overrides (`ELASTIC_*`).
- For batch configs: `defaults` is parsed first, then each `batch[]` entry overrides `name`, `startUrl`, and `crawl` for each expanded run.

### Validation behavior and errors (high level)
- Invalid JSON in `runs` launcher results in a JSON parse error before run starts.
- `run` validates config shape with Zod:
  - single-run requires `startUrl`,
  - batch-run requires `batch[]` with expected structure.
- Invalid shape throws descriptive errors (`Invalid config...`, `Invalid batch[...]...`, etc.).
- Missing files produce non-zero exit codes with explicit messages.

---

## D. Help output parity

### `npm run run -- --help`
```text
Usage: quality-signal run [options]

Options:
  -c, --config <path>  Path to JSON config file
  -h, --help           display help for command
```

### `npm run runs -- --help`
```text
Usage: npm run runs -- [options]

Options:
  --config <path>   Launch src/cli.ts run with the selected config path
  --list            List discoverable configs and exit
  -h, --help        Show this help message
```

### `npm run dashboard -- --help`
```text
Usage: npm run dashboard -- [options]

Options:
  --run <path>      Path to an artifact run directory (defaults to ARTIFACT_RUN_DIR or cwd)
  --port <number>   Port to bind server to (default: 4173)
  --static          Serve static assets from dist/dashboard
  -h, --help        Show this help message
```

### `npm run dashboards -- --help`
```text
Usage: npm run dashboards -- [options]

Options:
  --artifacts-dir <path>  Directory containing run folders (default: ./artifacts)
  --run <path>            Start dashboard for a specific run folder and skip prompt
  --port <number>         Port to bind dashboard server to (default: 4173)
  --list                  List available run folders and exit
  --no-open               Do not open a browser automatically
  -h, --help              Show this help message
```

**Exit code behavior:** help exits `0`; invalid args/config/file errors exit non-zero.

---

## E. End-to-end examples

### Run with a specific config
```powershell
npm run run -- --config .\config\example.config.json
```

### Run with overrides (via config file values)
There are no direct CLI flags for `headless`, `iteration`, `outputDir`, etc. Set those in the JSON config and run:
```powershell
npm run run -- --config .\config\my-overrides.config.json
```

### Start dashboard for latest run (using pointer file content)
```powershell
$latest = (Get-Content .\artifacts\latest-run.json | ConvertFrom-Json).latestRun
npm run dashboard -- --run $latest --port 4173
```

### Start dashboard for a chosen run folder
```powershell
npm run dashboard -- --run .\artifacts\2026-03-05T10-00-00-000Z
```

### Non-interactive equivalent for interactive config picker
```powershell
npm run runs -- --config .\config\example.config.json
```

### Non-interactive equivalent for interactive run picker
```powershell
npm run dashboards -- --run .\artifacts\2026-03-05T10-00-00-000Z --no-open
```
