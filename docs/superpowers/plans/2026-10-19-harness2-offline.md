# Harness² offline adapter implementation plan

> **For agentic workers:** Use superpowers:executing-plans task-by-task in one session. AGENTS.md requires a single agent for this engineering task.

**Goal:** Exercise Harness² recursion against the BA validation/canonical pipeline without credentials or external calls.

**Architecture:** A Python BenchmarkAdapter invokes a Node JSON-stdin bridge. A scripted provider consumes allowlisted guidance; the Harness² core owns propose/probe/compose and library persistence. A/B/C and frozen transfer runs produce integration evidence only.

**Tech Stack:** Node >=22.13; Python 3.12; pinned Harness² 0.1.0 source revision `1cfe254e8d25b15f37048c3730134686abe60335`.

**Spec:** `docs/HARNESS2_BENCHMARK.md`, approved by user on 2026-10-19. This plan implements its offline first phase; live model/corpus admission and semantic scoring remain separate.

## Global constraints

- No external model/Figma calls, no `.env` import and no production DATA_DIR writes.
- Synthetic fixtures never certify semantic accuracy, production acceptance or customer approval.
- Validate with `src/model-output.js`; use existing normalize/evidence/stable-ID/canonical functions.
- Candidate trees contain immutable instructions and a bounded JSON list of catalog guidance IDs only. No scripts, arbitrary prompt text or customer-derived memory.
- Usage/pricing without measurement is UNKNOWN. Do not copy upstream default costs into reports.
- Keep A/B/C budgets and memory access explicit; freeze train memory during held-out transfer.

### Task 1: Node bridge and contract tests

Files: `scripts/harness2/ba-runtime.mjs`, `tests/harness2-runtime.test.js`.

- [x] Write tests importing `runOfflineAnalysis`, `composeBenchmarkPrompt`, and `GUIDANCE`; check source identity, unchanged review flags, invalid output rejection and policy validation.
- [x] Run `node --test tests/harness2-runtime.test.js` and record the missing-module failure.
- [x] Implement `runOfflineAnalysis({task, guidanceIds=[], previous=null}, {provider=scriptedProvider}={})`. Accept only registered synthetic tasks. Build immutable policy plus catalog guidance, invoke provider, validate `analysisSchema`, normalize, merge stable IDs, apply evidence trust, prepare analysis and export canonical without database writes.
- [x] Implement CLI stdin/stdout transport guarded by direct execution; JSON input bounded to 64 KiB. Return instruction hashes, guidance IDs, canonical and UNKNOWN usage metadata, never full prompt.
- [x] Run contract tests including fake confirmed quotes and unchanged previous IDs.

### Task 2: Harness² adapter, experiment driver and integration tests

Files: `scripts/harness2/adapter.py`, `scripts/harness2/run.py`, `scripts/harness2/test_adapter.py`, `scripts/harness2.mjs`.

- [x] Write Python tests for forbidden tree edits, shell-safe Node bridge, A/B empty libraries, C online history, identical B/C probe counts, frozen transfer and output namespace protection.
- [x] Run the suite against missing adapter and record failure.
- [x] Implement `BAAdapter` against upstream `BenchmarkAdapter`, using a BA-specific `SurfaceSpec`, catalog-only `LongTermMEMORY.md`, pinned source check and sanitized child environment. Each execute uses a fresh private workspace; invalid candidate/output never produces a canonical deliverable.
- [x] Implement a deterministic `OfflineProposer(Proposer)` that inspects only source/context and prior catalog IDs, emits bounded guidance edits, and reflects generic catalog lessons; never reads gold or assigns semantic scores.
- [x] Implement baseline A via adapter execution; B via `run_task` without library; C via per-domain `Library`, ordered train tasks, immutable library wrapper for test. Run both recursion modes and online/frozen-transfer experiments with the same B/C k/seed/order.
- [x] Write an exclusive new namespace with manifest/code/corpus/policy hashes and atomic report; record every arm/case status, memory-before/after digest, counts, error status and UNKNOWN costs. Reject existing output rather than silently resume incompatible experiments.
- [x] Add npm launcher using explicit `HARNESS2_PYTHON` or the installed isolated virtualenv; missing dependency errors must explain setup. No silent skips in `eval:harness2`.
- [x] Run `npm run eval:harness2` and `npm run benchmark:harness2 -- --output /private/tmp/ba-h2-reviewed-run`.

### Task 3: Verification and handoff

Files: `package.json`, `docs/HARNESS2_BENCHMARK.md`, `docs/ARCHITECTURE.md` (offline tooling scope only).

- [x] Document exact commands, output interpretation, isolation limits and unimplemented live model/semantic evaluation.
- [x] Run doctor, npm test, quality, figma-contract, production, workspaces, serial and offline guardrail eval. Preserve the pre-existing recommendation failure separately; do not modify unrelated runtime behavior to hide it.
- [x] Review implementation against the approved design and inspect real generated canonical outputs and library histories.
- [x] Commit session checkpoint evidence preserving previous completed entries; export handoff with remaining live prerequisites and actual test failures. Do not mark the broader benchmark task finished while these remain.

## Execution evidence

Implemented inline on `feat/harness2-offline-benchmark`. Five Node and seven Python contracts pass. Both verified k=2 experiments have 24 successful records; memory remains frozen on transfer tests. Full and serial regression each pass 242/243 with the same pre-existing recommendation test failure. Quality, Figma contract, production, workspaces and offline guardrail eval pass. See `data/setup-evidence/harness2-implementation-20261019/verification.json` and committed session checkpoint/handoff for results and outstanding live prerequisites. No runtime learning or semantic improvement is claimed.
