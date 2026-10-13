# v3.2 — Intelligent BA Workflow (2026-10-13)

- Implemented `src/intelligent-workflow.js`: staged, checkpointed, resumable BA workflow with per-project `runId`, attempt metadata, failure record, explicit restart and quality gates.
- Added provider-neutral structured Brainstorming (`src/brainstorm.js`; Codex/OpenAI/DEMO) with draft-only hypotheses, questions and risks.
- Connected existing normalized elicitation, deterministic Gap Analysis, attributed customer response loop and explicit BA review to workflow driver.
- Added strict high-priority blocker acceptance (complete ID list, rationale, analysis-bound digest) rather than silently waiving critical questions.
- Added deterministic completeness metrics and FR design coverage check; draft Figma candidate screens fill gaps without inventing UI business controls.
- Implemented immutable-by-run local handoff export to `.workflow-artifacts` and Figma registry sync (reported verification only), preserving explicit MCP publish.
- New Workflow tab with stage timeline, uncertainty summary, questions, waiver, BA Review navigation and publish instructions.
- Added five-case synthetic gold evaluation, live-provider opt-in, and workflow integration/crash-recovery regression tests.
- Kept v3.1 manual API routes and Demo mode; no multi-agent, Claude runtime adapter, database, background worker or direct Figma publish API added.
