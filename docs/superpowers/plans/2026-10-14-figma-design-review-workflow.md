# Figma Design Review Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let BA Studio start a local-safe TalkToFigma relay, publish a reviewed design, and show only explicitly approved per-screen previews in Prototype.

**Architecture:** Add a managed loopback Bun relay and a version-bound Figma design-review state module. Route design work through the existing SQLite queue and fencing leases, refactor publication so both the worker and legacy CLI share one publisher, and persist preview artifacts in the immutable project workspace. Keep the existing HTML prototype and manual Figma APIs compatible.

**Tech Stack:** Node.js >=22.13 with built-in `node:sqlite`, Bun, HTTP server, SQLite WAL, Codex CLI structured output, TalkToFigma MCP, vanilla browser JavaScript, and Node test runner.

**Spec:** `docs/superpowers/specs/2026-10-14-figma-design-review-workflow.md`

## Global Constraints

- SQLite WAL remains the authoritative store; project workspaces are project-UUID-scoped artifact projections.
- All Figma writes remain user-triggered and require existing BA Review; Figma plugin launch remains manual.
- The local relay binds to `127.0.0.1`; do not persist raw WebSocket payloads or customer text in logs or `ai_invocations`.
- Use fixed executable/arguments; never execute user-provided commands or paths.
- Each run is bound to project version, workflow run, manifest digest, and file key; stale workers cannot commit.
- Preserve FR, NFR, Q, and SCR IDs; preserve old Figma sections and historical review results.
- Internal design approval does not set BA Review, customer approval, or customer baseline fields.
- Existing manual workflow/Figma APIs and HTML prototype remain backward compatible.
- Do not change quality gate or telemetry behavior.

## Review Focus

1. Malformed, non-HTTPS, non-Figma, or unsupported-path URLs must fail before enqueueing; test URL parsing and host/path rejection in Task 2.
2. A spoofed or wrong channel/file pairing must fail before any Figma write; test preflight identity mismatch in Task 3.
3. A stale project version or manifest must reject completion and approval; test stale result/approval fencing in Tasks 2 and 4.
4. Partial Figma writes, missing frame reports, or invalid image bytes must not expose a draft for review; test incomplete publish artifacts in Tasks 3 and 4.
5. A request from a remote-bound deployment must not start the loopback relay; test local-host enforcement in Task 1 and its HTTP route in Task 4.

---

## File Structure

- Create `src/figma-relay.js` for process lifecycle and status; create `vendor/talk-to-figma-relay/socket.ts` and `vendor/talk-to-figma-relay/NOTICE.md` as the pinned local-safe upstream-compatible relay with MIT attribution.
- Create `src/figma-design-review.js` for URL/channel validation and pure, version-bound state transitions.
- Create `src/figma-publisher.js` for reusable design-pack publication, report validation, and image preview export; keep `scripts/figma-design.mjs` as a backward-compatible CLI adapter.
- Modify `src/server.js` to add relay routes, design-run routes, and a worker dispatch path for Figma design jobs.
- Modify `src/project-workspaces.js` to persist previews under the project UUID and expose safe project-scoped preview reads.
- Modify `public/app.js`, `public/style.css`, and `public/index.html` for setup, loading, per-screen review, and approved gallery states.
- Modify `scripts/doctor.mjs`, `.env.example`, `docs/figma-handoff.md`, and README setup guidance for Bun/relay configuration and lifecycle.
- Create `tests/figma-relay.test.js`, `tests/figma-design-review.test.js`, `tests/figma-design-review-http.test.js`, and focused UI contract coverage in `tests/figma-review-ui.test.js`; extend `tests/figma.test.js` and `tests/v36-project-workspaces.test.js` for publisher and preview behavior.

## Task 1: Local-safe Relay Lifecycle

**Files:**
- Create: `vendor/talk-to-figma-relay/socket.ts`, `vendor/talk-to-figma-relay/NOTICE.md`
- Create: `src/figma-relay.js`
- Create: `tests/figma-relay.test.js`
- Modify: `.env.example`, `scripts/doctor.mjs`, `docs/figma-handoff.md`

**Interfaces:**
- `createFigmaRelayManager({bunExecutable, relayEntry, host='127.0.0.1', port=3055})` returns `{start(), stop(), status()}`. Runtime defaults come only from process configuration; tests inject a fixture executable.
- `status()` returns `{state:'STOPPED'|'STARTING'|'READY'|'FAILED', host, port, errorCode}` and never includes child output.
- The vendored relay accepts only the existing TalkToFigma join/message protocol, binds to `127.0.0.1:3055`, and emits no message payloads to stdout/stderr.

- [ ] **Step 1: Write failing relay tests** for start, duplicate start, stop, child exit, port failure, loopback bind configuration, and absence of payload logging.
- [ ] **Step 2: Run** `node --test tests/figma-relay.test.js`; confirm the relay manager/module is missing or behavior fails.
- [ ] **Step 3: Implement** the minimal protocol-compatible relay with upstream MIT attribution and process lifecycle with fixed args, no shell, drained/discarded stdout/stderr, and graceful-then-forced stop.
- [ ] **Step 4: Run** `node --test tests/figma-relay.test.js`; require all lifecycle and local-only checks to pass.
- [ ] **Step 5: Update** `scripts/doctor.mjs`, `.env.example`, and Figma setup docs with `BUN_BIN`/relay readiness requirements and same-host limitation.
- [ ] **Step 6: Commit** only Task 1 files with `feat: manage local Figma relay`.

## Task 2: Version-Bound Design Review State

**Files:**
- Create: `src/figma-design-review.js`
- Create: `tests/figma-design-review.test.js`

**Interfaces:**
- `parseFigmaDesignInput({fileUrl, channelId}) -> {documentKey, channelId}` accepts HTTPS `figma.com` or subdomains, `/design/<file-key>` or `/file/<file-key>`, file keys matching the existing `[\w-]{3,128}` contract, and channel IDs matching `[A-Za-z0-9_-]{1,128}`.
- `beginFigmaDesign(project, {documentKey, channelId, jobId}) -> project` initializes a project-scoped run bound to the current project version and workflow run.
- `completeFigmaDesign(project, {runId, projectVersion, manifestDigest, screens, previewFiles}) -> project` moves to `WAITING_FOR_REVIEW` only when every planned screen has full FR coverage, a unique verified node ID, and one validated JPEG preview.
- `reviewFigmaDesign(project, {decision, notes, reviewerId, projectVersion, manifestDigest}) -> project` accepts `APPROVE` or `REQUEST_CHANGES`, binds the decision to the exact draft, and rejects stale inputs.

- [ ] **Step 1: Write failing tests** for accepted Figma URL forms, rejected schemes/hosts/paths/keys/channels, incomplete screen coverage, duplicate node IDs, missing previews, approval, change requests, and stale project/manifest digests.
- [ ] **Step 2: Run** `node --test tests/figma-design-review.test.js`; confirm missing exports and failing transitions.
- [ ] **Step 3: Implement** pure validation and state transitions with exact states from the spec and no writes to customer approval fields.
- [ ] **Step 4: Run** `node --test tests/figma-design-review.test.js`; require all input and transition cases to pass.
- [ ] **Step 5: Commit** Task 2 files with `feat: add versioned Figma design review state`.

## Task 3: Reusable Publisher and Per-Screen Previews

**Files:**
- Create: `src/figma-publisher.js`
- Modify: `scripts/figma-design.mjs`, `src/figma-registry.js`, `src/codex-provider.js`
- Test: `tests/figma.test.js`

**Interfaces:**
- `publishFigmaDesign({project, designPack, documentKey, channelId, revisionNotes, outputDirectory, runner}) -> {documentKey, manifestDigest, screens, previews, notes}`.
- Each screen report has `{screenId,nodeId,verified:true,preview:{contentType:'image/jpeg',base64}}`; reject unknown/duplicate IDs, false verification, mismatched file key, invalid base64, or previews larger than 5 MiB decoded per screen. A revision forces a new Figma section and new frames for the requested design version; earlier frames remain untouched.
- `runCodexStructured(prompt,schema,{maxOutputBytes})` keeps its 2,000,000-byte default; each JPEG export is a separate sequential structured call capped at 8 MiB output so an all-screen response cannot exceed the existing provider-output bound.
- `scripts/figma-design.mjs` retains all existing CLI flags and offline pack behavior and delegates publishing to the shared publisher.

- [ ] **Step 1: Extend publisher tests** to require file-key preflight before drawing, report-to-plan coverage, one bounded JPEG export per screen, revision feedback creating a new section/frames, preview validation, preservation of prior accepted report/registry on failure, and no raw provider output in logs.
- [ ] **Step 2: Run** the targeted Figma test; confirm incomplete preview/report cases are not accepted.
- [ ] **Step 3: Implement** the shared publisher. It invokes the configured Codex runner, uses UI UX Pro Max and TalkToFigma, exports one JPEG per frame in a sequential bounded call, and passes revision notes as design-only feedback. Revision runs force new versioned frames without mutating prior sections.
- [ ] **Step 4: Refactor** the legacy CLI to call the shared publisher while preserving current CLI arguments, file-scoped registry, lease/version checks, and manual behavior.
- [ ] **Step 5: Run** `node --test tests/figma.test.js`; require existing offline CLI contracts and the new preview cases to pass.
- [ ] **Step 6: Commit** Task 3 files with `feat: export verified Figma screen previews`.

## Task 4: Durable API, Worker, Audit, and Workspace Artifacts

**Files:**
- Modify: `src/server.js`, `src/production-store.js`, `src/project-workspaces.js`
- Create: `tests/figma-design-review-http.test.js`
- Extend: `tests/v36-project-workspaces.test.js`

**Interfaces:**
- `GET /api/figma/relay` returns relay status; `POST /api/figma/relay/start` and `/stop` manage only the configured process and reject remote-bound use.
- `GET /api/projects/:id/figma-design` returns project-scoped run/review state without raw channel data after terminal completion.
- `POST /api/projects/:id/figma-design` accepts `{fileUrl,channelId}` or `{revisionNotes}` and enqueues `{kind:'figma-design',documentKey,channelId,revisionNotes,projectVersion}` using the existing durable queue with `maxAttempts:1` for external Figma writes.
- `POST /api/projects/:id/figma-design/review` accepts `{decision:'APPROVE'|'REQUEST_CHANGES',notes,projectVersion,manifestDigest}` and requires `reviewerId(req)`.
- `GET /api/projects/:id/figma-design/previews/:screenId` serves only an image referenced by the current draft review or approved version, with path traversal and cross-project reads rejected.

- [ ] **Step 1: Write failing HTTP tests** for relay control/status, remote-bind rejection, BA Review prerequisite, malformed input, queue state, reviewer audit, stale result/approval rejection, terminal channel cleanup, and scoped preview reads.
- [ ] **Step 2: Run** `node --test tests/figma-design-review-http.test.js tests/v36-project-workspaces.test.js`; confirm routes and preview storage are missing.
- [ ] **Step 3: Implement** relay routes and project design routes, returning versioned project state with existing If-Match behavior.
- [ ] **Step 4: Implement** worker dispatch for `job.options.kind==='figma-design'`; use the claimed project lease for final project/registry commit and reject stale or partial results as non-retryable until inspected. Require an explicit new user retry after uncertain Figma mutation.
- [ ] **Step 5: Store** preview files under `DATA_DIR/projects/<uuid>/04-figma/exports/<version-platform>/previews/`; validate image bytes, use mode 0600, and bind metadata to project/version/manifest/screen IDs.
- [ ] **Step 6: Audit** reviewer approvals and change requests with actor, exact manifest digest, screen IDs, decision, and timestamp; exclude channel ID, feedback text, prompt text, and payloads from audit/log details. Remove transient channel IDs from terminal queue job options while retaining retry inputs until a job is terminal.
- [ ] **Step 7: Run** the targeted HTTP and workspace tests; require passing queue recovery, lease fencing, project isolation, and preview authorization checks.
- [ ] **Step 8: Commit** Task 4 files with `feat: queue and audit Figma design reviews`.

## Task 5: Prototype UI and Full Regression

**Files:**
- Modify: `public/app.js`, `public/style.css`, `public/index.html`, `README.md`, `docs/figma-handoff.md`
- Create: `tests/figma-review-ui.test.js`

**Interfaces:**
- Prototype setup has distinct states for relay stopped/starting/ready, waiting for manual Figma plugin connection, queued/designing, failed, and waiting for review.
- Review cards are keyed by screen ID and show mapped FR IDs, static preview, and Figma frame link; buttons send exact draft digest/version for approve or request-changes decisions.
- The approved gallery renders only the server-returned approved version; the current HTML prototype remains separately rendered.

- [ ] **Step 1: Write failing UI contract tests** for tooltip/help text, setup and progress states, per-screen FR mapping, approval/revision actions, and exclusion of unapproved previews from the approved gallery.
- [ ] **Step 2: Run** `node --test tests/figma-review-ui.test.js`; confirm the new UI contract is absent.
- [ ] **Step 3: Implement** the setup form, relay status controls, Figma URL/channel fields and inline help, loading state, per-screen review cards, revision notes, approved gallery, and frame links.
- [ ] **Step 4: Update** setup documentation to explain local Bun, manual plugin launch, the displayed channel ID, retry/partial-write behavior, and remote-bound limitation.
- [ ] **Step 5: Run** `node --test tests/figma-review-ui.test.js` and relevant existing prototype/workflow tests; require existing HTML prototype controls to remain unchanged.
- [ ] **Step 6: Run required regressions** with Node >=22.13: `npm test`, `npm run test:serial`, `npm run eval:production`, `npm run eval:quality`, `npm run eval:figma-contract`, `npm run eval:workspaces`, `npm run eval:continuity`, and `npm run doctor`.
- [ ] **Step 7: Review** `git diff`, ensure no pre-existing unrelated work was staged, then commit Task 5 files with `feat: add Figma setup and design approval UI`.

## Handoff Notes

- Before execution, use `superpowers:using-git-worktrees` and inspect the pre-existing dirty files. Do not discard or stage pre-existing modifications; carry forward only the source state needed for this feature.
- Execute tasks in order because each publishes an interface used by the following task.
- Do not claim Figma creation, node read-back, or visual QA success from offline tests. Live Figma work requires an operator-approved project, explicit file/channel input, and human inspection.
