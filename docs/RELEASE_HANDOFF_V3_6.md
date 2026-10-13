# BA Studio v3.6 — Release Handoff to Next Codex/Claude Session

Version: 0.3.6  
Release date: 2026-10-13  
Architecture: Single-agent + provider adapters; shared local SQLite (WAL), project directories, durable workflow worker.  
Status: SOURCE IMPLEMENTATION COMPLETE, OFFLINE TESTED; LIVE ACCEPTANCE STILL NOT EXECUTED.

## Completed in v3.6

- Preserved v3.1–v3.5 orchestration, quality, review, job queue, Figma challenge, and SQLite continuity.
- Project workspaces under `DATA_DIR/projects/<immutable project UUID>/` with safe directory creation.
- BRD/SRS/PRD and canonical document projections, current prototype, customer brief, BA Review, Figma registry, design pack and immutable per-version snapshot under each project.
- Project-scoped jobs, audit, quality history and AI usage snapshots.
- Immutable customer/reference/approval text-document attachments with sha256 and audit; REST endpoints and a UI tab.
- v3.5 `continuity_tasks` filtered by project, project evidence base, session handoff/ledger and `BA_ACTIVE_PROJECT_ID` hook selection.
- Safe copy-only migration for legacy `.figma-registry/<uuid>` and `.workflow-artifacts/<uuid>`; existing old artifact pointers may remain until workflow regeneration.
- Validation: 100/100 serial tests; 8 v3.6 tests; offline doctor, guardrails and Figma contract all passed.

## Decisions

1. SQLite shared across BA projects remains the transactional registry/queue; filesystem is per-project artifact storage and rebuildable projection. Per-project DB shards and multi-host HA are deferred.
2. Project folder identity is an immutable UUID, never user-entered title or slug.
3. Generated documents remain draft; no inferred acceptance, KPI, customer consent or Figma publish.
4. No automatic migration deletion. Archive old paths with full data backup before cleanup.
5. Each project-specific Codex/Claude task must be bootstrapped with `--project <uuid>`, and checkpoint evidence paths must be relative to project workspace.

## Known limitations / risks

- SQLite+filesystem are not one ACID transaction. A crash can leave stale workspace projections; run `project:migrate`, compare versions and do not trust stale `PROJECT_STATE.json`.
- Shared SQLite and one application authorization boundary mean this is NOT tenant RBAC isolation. Add users/roles/project memberships before multi-client network access.
- Supplemental upload supports UTF-8 `.txt`, `.md`, `.csv`, `.json` up to 300KB. PDF/DOCX uploads, malware scanning and document provenance approval are NOT part of v3.6.
- Live Codex/OpenAI semantic benchmark and live Figma MCP contract tests remain not executed due to missing provider credentials, gold corpus and Figma live session.
- Old v3.5 task evidence paths may need manual reconciliation after project-specific path interpretation changes. Snapshot history is recoverable from SQLite but uncommitted conversation text is not.
- `npm run backup` snapshots SQLite only; archive `data/projects/` and legacy paths separately.

## Resume protocol

1. Read `AGENTS.md` / `CLAUDE.md`, this handoff, `docs/MULTI_PROJECT_WORKSPACES_V3_6.md`.
2. `npm run doctor`, `npm run project:status`. For BA project task, `npm run session:bootstrap -- --project <uuid>`.
3. Verify actual source and DB state rather than trusting document projections. `RECONCILE` must be investigated before resume.
4. Run `npm run eval:workspaces`, `npm run test:serial` after code changes. Preserve PRD review and Figma publish gates.
5. Checkpoint and export handoff at each milestone and before switching contexts.

## Proposed next action

Add project-level RBAC/authentication for multiple users before exposing this multi-project service over a network. If offline/local-only, consider document ingestion for PDF/DOCX and a projection health/repair dashboard. Do NOT adopt multi-agent orchestration just to separate customer project directories.
