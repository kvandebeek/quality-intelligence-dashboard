# Diagnostics and Logging Guide

## Log locations

- Structured JSON logs are written to `./logs/*.jsonl`.
- Files rotate daily and by size (`5MB` default).
- Retention defaults to `14 days` and older log files are cleaned automatically.

## Log entry fields

Each log record includes:

- `timestamp` (ISO-8601 with timezone)
- `level` (`DEBUG`, `INFO`, `WARN`, `ERROR`, `FATAL`)
- `message`
- `appVersion`
- `buildId`
- `runId` (unique per process run)
- `operationId` (unique per operation/action when present)
- `context` object with optional fields such as:
  - `datasetPath`
  - `urlId`
  - `section`
  - `view`
  - `filePath`
  - `durationMs`
  - `count`
- `error` object (`name`, `message`, `stack`) for failures.

## Redaction policy

The logger automatically redacts sensitive values and truncates oversized strings.

Redacted key patterns include (case-insensitive):

- `token`
- `cookie`
- `password`
- `secret`
- `authorization`
- `apiKey` / `api_key`
- `session`

Path values are sanitized to replace the current user's home directory with `~`.

## Export diagnostics

Use the **Export diagnostics** button in the dashboard UI.

The server generates a ZIP under `logs/diagnostics/` containing:

- copied current log files (`logs/*.jsonl`)
- `metadata.json` (platform/runtime/memory/build/run metadata)
- `config.snapshot.json` (sanitized runtime config snapshot)

## Troubleshooting workflow

1. Reproduce the issue in the dashboard.
2. Enable **Verbose logging** in the UI to elevate to `DEBUG`.
3. Use **Export diagnostics** to produce a ZIP.
4. Attach the ZIP when sharing with Codex/support.
5. Validate no sensitive data leaked by searching logs for common secrets, e.g.:

```bash
rg -n "token|authorization|password|cookie|secret|api[_-]?key" logs
```
