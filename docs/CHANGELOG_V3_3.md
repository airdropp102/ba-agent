# v3.3 change log (2026-10-13)

- Replaced canonical JSON project storage with SQLite WAL, transactional project revisions, history snapshots, and hash-chained reviewer/audit events. Legacy JSON files are imported once and mirrored for compatibility only.
- Added persisted workflow job queue, project-level lease fencing, 10-second heartbeat, bounded retry/dead-letter, orphan recovery and multi-process concurrency protection.
- Added worker-only execution (`npm run worker`) and preflight requirement Node >=22.13; CLI uses Node built-in SQLite.
- Added Figma MCP read-back challenge (single-use nonce scoped to project/run/file/manifest/frames) and required separate human BA visual QA; challenge use + project commit are atomic.
- Added SQLite consistent backup command and operational instructions.
- UI runs via durable queue and exposes jobs/audit status and BA Figma visual QA approval.
- Added `tests/v33-production.test.js` covering stale writers, competing workers, dead-letter, crash restart, Figma read-back replay/QA and audit integrity.
- No live Figma MCP attestation or real-model accuracy benchmark was performed; operator reports and DEMO semantic proxy are explicitly labelled.
