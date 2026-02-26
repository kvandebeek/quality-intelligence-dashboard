# REQUIREMENTS

> Note: The prompt provided a placeholder (`[PASTE REQ1..REQ51 HERE EXACTLY]`) rather than literal REQ statements. To proceed without blocking, the following derived requirements map the explicit instructions in the prompt into REQ1..REQ51 IDs.

Total enumerated requirements: 51.

- REQ1: Implement a test automation and report generation engine (not a long-running service).
- REQ2: Use Playwright with TypeScript as execution engine.
- REQ3: Collect client-side performance timing metrics.
- REQ4: Collect HAR/network artifacts.
- REQ5: Generate network optimization recommendations.
- REQ6: Collect accessibility scan results using axe-core Playwright integration.
- REQ7: Enrich accessibility issues with recommendations.
- REQ8: Compute accessibility severity counters.
- REQ9: Write outputs as JSON artifacts per run.
- REQ10: Write a run summary index artifact.
- REQ11: Support optional publishing to Elasticsearch.
- REQ12: Keep tool runnable locally.
- REQ13: Keep tool runnable in CI.
- REQ14: Deliver full project code in TypeScript.
- REQ15: Maintain DECISIONS.md with assumptions and tradeoffs.
- REQ16: Maintain REQUIREMENTS_TRACEABILITY.md mapping requirements to implementation.
- REQ17: Provide README with a short “How to run” section.
- REQ18: Archive existing repo content before new implementation.
- REQ19: Preserve archived files by moving, not deleting.
- REQ20: Do not touch .git content.
- REQ21: Archive path format must be _archive/<YYYYMMDD-HHMMSS>/.
- REQ22: Move all prior top-level files/folders except .git and _archive.
- REQ23: Archive move must be a single commit titled "Archive legacy repo state".
- REQ24: After archive commit, start new implementation scaffolding.
- REQ25: Ensure TypeScript strict mode.
- REQ26: Avoid arbitrary sleeps for deterministic behavior.
- REQ27: Use environment variables for secrets/configuration.
- REQ28: Avoid hardcoded secrets.
- REQ29: Deterministic artifact naming.
- REQ30: Include run metadata (timestamp, target URLs, browser, environment, iteration).
- REQ31: Provide example configuration.
- REQ32: Provide sample run commands.
- REQ33: Initialize CHECKLIST.md with all requirements and status tracking.
- REQ34: Initialize REQUIREMENTS_TRACEABILITY.md with REQ -> mapping.
- REQ35: Initialize DECISIONS.md.
- REQ36: Provide architecture outline.
- REQ37: Implement phased delivery.
- REQ38: At phase end, report REQs closed and REQs remaining.
- REQ39: End each phase in runnable state.
- REQ40: Collect navigation/performance APIs data.
- REQ41: Parse HAR into normalized network records.
- REQ42: Export performance JSON per target.
- REQ43: Export network JSON per target.
- REQ44: Export accessibility JSON per target.
- REQ45: Provide page journey runner over configured targets.
- REQ46: Define deterministic artifact folder structure.
- REQ47: Implement CLI entrypoint and config validation.
- REQ48: Provide Elasticsearch mapping/template creation for publishing path.
- REQ49: Include CI workflow for build/test execution.
- REQ50: Add basic automated test coverage.
- REQ51: Ensure final repository root contains only archive plus new implementation files.
