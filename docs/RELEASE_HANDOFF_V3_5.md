# BA Studio — Release Handoff v3.5

Last verified: 2026-10-13. This is a **release baseline** for human/agent operators, not a fabricated record of native Claude/Codex chat context or a live BA acceptance signoff.

## Purpose

Continue BA Studio after switching agents or model sessions without repeating validated implementation work. The session ledger begins accumulating new runtime checkpoints **only when tasks are created and checkpointed** with `scripts/session-continuity.mjs`; the static summary below bridges the existing version history distributed in documentation.

## Verified completed work

| Release | Delivered | Evidence |
|---|---|---|
| v3.1 | Provider-output validation, optimistic concurrency, setup/doctor and guardrails | `docs/ARCHITECTURE_V3_1.md`, `tests/v31-hardening.test.js` |
| v3.2 | Intelligent BA workflow with human gates and persistent checkpoints | `docs/ARCHITECTURE_V3_2.md`, `tests/v32-workflow.test.js` |
| v3.3 | SQLite project store, durable queue/retry, Figma read-back and audit | `docs/ARCHITECTURE_V3_3.md`, `tests/v33-production.test.js` |
| v3.4 | Quality rubric/history, AI telemetry, offline MCP contract and benchmark | `docs/ARCHITECTURE_V3_4.md`, `tests/v34-quality.test.js` |
| v3.4 Live Acceptance extension | Live runner, two BA reviewers, adjudication, independent Figma REST cross-check and final release gate (OFFLINE tests) | `docs/LIVE_ACCEPTANCE_V3_4.md`, `tests/v34-live-acceptance.test.js` |
| v3.5 | Task/session ledger, explicit new/resume, committed handoff, version fencing, evidence SHA drift, optional Claude/Codex lifecycle hooks | `docs/SESSION_CONTINUITY_V3_5.md`, `tests/v35-session-continuity.test.js` |

## Validation last performed

- Baseline v3.4: 76/76 regression tests; live provider acceptance **NOT EXECUTED**.
- Updated v3.5: `npm run test:serial` **90/90 PASS**, v3.5 test suite **14/14 PASS**.
- `npm run eval`, `npm run eval:quality`, `npm run eval:figma-contract`, `npm run doctor`: offline PASS. Doctor warns about absent operator price catalog.
- CLI smoke tested: create → checkpoint → verify → export → `PreCompact` hook; valid, local only.
- Claude and Codex hook activation has **not** been tested in actual interactive CLI sessions, and the live acceptance workload (20–50 BA reviewed cases, live model, live Figma read-back) remains **NOT EXECUTED**.

## Decisions that must survive model compaction

1. Use one engineering agent per task, with shared SQLite through Node CLI; no additional multi-agent architecture.
2. Keep existing business `workflow_jobs` independent from engineering `continuity_tasks`.
3. SQLite WAL on a **single local host** is the authoritative state. A handoff file is a disposable projection, not the source of truth.
4. `completed` steps require real files with matching SHA-256, and invalidation is explicit and explained.
5. The new agent must inspect `git diff`, source, checks and DB before trusting a summary; on mismatch choose `RECONCILE`, not blind resume.
6. Hooks cannot introspect hidden model thoughts or guarantee preservation of an uncheckpointed change. Checkpoint after each milestone; use hooks as best-effort reminders/exports.
7. Do not promote demo BA metrics, Figma operator reports or offline contracts into live production acceptance.

## Next actions

1. Validate `.codex/hooks.json` and `.claude/settings.json` with installed **real** Codex/Claude CLI versions and confirm trust/approval; use manual CLI if native hooks are unavailable.
2. Run the v3.4 live acceptance process on **approved** 20–50 BA briefs and a permissioned Figma test file. Configure external credentials locally only.
3. Record every new engineering task with `npm run session:new`, a checkpoint after each milestone, and `npm run session:handoff` before switching sessions.
4. For multi-machine continuity or shared team access, specify RBAC and migrate to Postgres + MCP server; do not put SQLite WAL on a network filesystem.

## Resume next session

```bash
npm run setup
npm run session:bootstrap
# Choose explicit task ID: RESUME or NEW_TASK
npm run test:serial
```

If the state DB is not supplied (e.g., a clean ZIP checkout), `session:bootstrap` **correctly says NEW_TASK**: consult this release handoff for the previous release's verified work, then create the next task in the ledger. Do not invent legacy session checkpoints that were never committed.

## Outstanding risks

- Context can be lost if work was never checkpointed before termination.
- Hooks can be skipped in untrusted/unconfigured workspaces and are not validated live.
- SHA hashes establish artifact identity, not quality, provenance or cryptographic authorization.
- Multiple users on different machines require a dedicated server-side auth/storage design.
