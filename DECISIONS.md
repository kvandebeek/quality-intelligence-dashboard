# DECISIONS

## Requirement interpretation decisions
- Decision D1: The explicit REQ1..REQ51 text was not provided and was replaced by a placeholder in the prompt. Derived REQs were created from the provided mandatory rules and feature summary to keep execution unblocked.

## Technology choices
- Decision D2: Recursive crawling is implemented in a dedicated `src/core/crawler.ts` module so traversal policy is isolated from collectors and publishing.

## Architecture tradeoffs
- Decision D3 (BFS vs DFS): Chose queue-based BFS to align with deterministic shallow-first exploration and to make `maxDepth` semantics straightforward and predictable across runs.
- Decision D4 (Depth limiting): Depth is enforced before enqueue/execution of children to guarantee deterministic termination and avoid unnecessary browser work.
- Decision D5 (Deterministic ordering): Child links are normalized, de-duplicated, sorted lexicographically, then enqueued so crawl order is stable regardless of DOM link ordering.

## Ambiguities and resolutions
- Decision D6: `includeExternalDomains=true` allows all domains, while `false` restricts to base domain plus `allowedDomains`.
- Decision D7: `totalPagesDiscovered` counts unique normalized URLs accepted into crawl scope (visited set), and skipped URLs are separately captured with reasons.
