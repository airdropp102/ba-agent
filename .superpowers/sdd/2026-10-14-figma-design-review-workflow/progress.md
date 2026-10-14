# SDD ledger — plan: docs/superpowers/plans/2026-10-14-figma-design-review-workflow.md

Ruling: The installed Superpowers cache no longer contains executing-plans/task-start, so tasks are started from the committed plan's exact task sections and ledgered here; TDD instructions remain available and were read. Cost: brief generation metadata is not separately emitted by the removed helper.
Ruling: Worktree tests require TMPDIR=/private/tmp because this macOS environment exposes /tmp symlinked outside temporary evidence roots; use TMPDIR=/private/tmp for regression commands. Cost: test command environment differs from default shell only for temp-root safety tests.
Ruling: Bootstrap's initial default checkout data path reports a separate global ledger; this worktree must pass DATA_DIR pointing to the shared same-host repo data directory to access task 1349abbe. Cost: shared local SQLite WAL is used by the linked worktree as intended by v3.3.

Pre-flight: Task 1 output relay manager/status + local-safe protocol relay; Task 4 consumes these exports/process semantics for relay HTTP endpoints. Interface compatibility checked against plan: manager methods start/stop/status, status state + loopback host/port/safe code, no child output; Task 4 can consume unchanged.
Task 1: complete — commit e1faa89; 5/5 relay tests and doctor --figma pass.

Task 2: complete — URL/channel validation, screen/preview coverage and version-bound decisions pass.

Task 3: complete — shared publisher, file preflight, per-screen bounded JPEG exports, revision-safe sections; 22/22 targeted tests pass.

## Task 4 — HTTP, durable queue, review and project previews
- Added loopback-only relay lifecycle endpoints and Figma design queue/review/preview routes. Project and job JSON responses redact channel IDs and revision notes; terminal Figma jobs scrub the channel credential.
- Added fenced worker dispatch using the shared publisher, project-scoped registry, versioned design pack and immutable JPEG previews. Draft review binds project version + manifest digest; approve and change-request decisions are audited and do not modify BA/customer approval.
- Added `FigmaPreviewStore` with UUID-only paths, symlink rejection, JPEG signature, size and SHA-256 validation.
- Corrected the state contract to accept only `04-figma/exports/v<version>-<platform>/previews/<run UUID>/<screen>.jpg`.
- Shutdown behavior stops the managed relay and closes the server/store.
- Targeted API, preview, state, and workspace tests pass; full regression results are in continuity checkpoint 16.
- Limit: actual Codex/TalkToFigma publication remains an operator-connected live action; offline checks do not attest Figma frames or customer approval.

## Task 5 — Prototype setup and per-screen review UI
- Added relay status/start/stop controls, Figma URL and channel form with accessible tooltip guidance, manual plugin connection instructions, and a drawing progress state.
- Added draft previews grouped by screen with FR mapping, frame links, version/digest-bound approve or revision-request actions, and an approved-only gallery. Existing HTML prototype remains a separate section.
- Documented the workflow and added UI state/contract tests. Screen gallery and approval state are server-authoritative; no UI approval is claimed as customer sign-off.
- Verification: `npm test` and `npm run test:serial` passed 180/180; `npm run eval:production` passed; `npm run eval:quality` completed in offline synthetic/demo mode (not a semantic accuracy claim); `npm run eval:figma-contract` passed 1 positive/4 rejected cases, live MCP not verified; `npm run eval:workspaces` passed 10/10; `npm run eval:continuity` passed 16/16; `npm run doctor` passed with price catalog UNKNOWN warning; JS syntax and git diff checks passed.
- Remaining operator validation: open/connect the Figma plugin manually and inspect actual frames in Figma after a design run.
