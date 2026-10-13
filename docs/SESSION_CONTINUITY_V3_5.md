# BA Studio v3.5 — Session Continuity & Context Handoff

> Status: implemented and tested offline. This is an **engineering agent session** ledger that complements, but does not replace, BA workflow checkpoints and worker leases. No context window usage telemetry is inferred automatically.

## Why two persistence layers?

1. BA business workflows: `projects`, `workflow_jobs`, stages, review and artifacts in SQLite WAL (v3.3+). Worker resumes jobs after crash via lease fencing.
2. Codex/Claude coding and documentation sessions: `continuity_tasks`, `continuity_sessions`, `continuity_checkpoints` added in v3.5. Each task represents a distinct piece of work. A new agent session must explicitly choose RESUME or NEW_TASK.

Use a **single agent** per active engineering task. Both runtimes use the **same Node.js CLI and SQLite database**; no platform-specific duplicate tools. MCP not required on one host. If teams need remote shared storage across hosts, expose authorized MCP tools backed by an actual shared transactional store (not SQLite WAL on NFS).

## Boot contract — always before working

```bash
npm run setup
npm run session:bootstrap
```

`bootstrap` reads live SQLite and SHA-256 evidence, returning one of:

| Result | Required action |
|---|---|
| `NEW_TASK` | No unfinished tasks: create a new task, do not silently reset previous tasks |
| `RESUME` | One unfinished task with intact evidence: verify git diff / code and resume explicitly |
| `CHOOSE_TASK` | Multiple unfinished tasks: select task ID; do not guess |
| `RECONCILE` | Evidence missing/modified or checkpoint corrupted: investigate and invalidate/recreate evidence; no automatic resume |

Status is *derived*. Hook startup is read-only and does not claim ownership of a task.

## Start a new task

```bash
npm run session:new -- --title "Implement API quality gate" --runtime codex
```

Response contains `task.id`, `task.version`, and `session.id`. Preserve the IDs in the current working context. For Claude pass `--runtime claude`. Optionally use `--file task.json` to associate the session with a BA project ID (`scope: "ba-workflow"`, `projectId: "<uuid>"`) without altering the BA project state.

## Write a checkpoint after each meaningful milestone

Create a private JSON file **outside the version-controlled repository or delete it immediately after use**:

```json
{
  "taskId": "<uuid from session:new>",
  "sessionId": "<uuid from session:new>",
  "expectedVersion": 1,
  "operationId": "milestone-001",
  "summary": "Implemented session schema and validated the migration",
  "inProgress": "Running integration tests",
  "completed": [
    {"id": "SCHEMA-1", "title": "Design schema", "artifacts": ["src/session-continuity.js", "docs/SESSION_CONTINUITY_V3_5.md"]}
  ],
  "next": ["Run regression", "Review hooks on Claude and Codex"],
  "decisions": ["SQLite remains authoritative; Markdown is only a projection"],
  "risks": ["Live hook activation not verified"],
  "checks": [{"command": "npm run eval:continuity", "result": "PASS"}],
  "context": {"usedTokens": null, "maxTokens": null}
}
```

```bash
npm run session:checkpoint -- --file /secure/checkpoint.json
```

**Rules:**

- Every completed step requires an existing **regular file** inside the workspace, stored with SHA-256 hash. Symlinks, path traversal and missing files are rejected. Hashes are artifact-integrity checks, not attestations of correctness.
- Every checkpoint is a *full current task snapshot*, not just the delta. Preserve previous `completed` entries and updated `next` work. To withdraw a completed step, include `invalidations: [{"id": "SCHEMA-1", "reason": "..."}]` and omit that step from `completed`. Do not leave obsolete evidence marked valid.
- Store `checks` with PASS/FAIL/NOT_RUN. PASS is **agent-reported**, not proof that the command actually ran. Attach `output: "relative/test-log.txt"` if available for inspection. Tests must be actually executed by the operator/agent.
- The CLI requires `expectedVersion`, reject stale writes, supports idempotent `operationId` replays, and protects checkpoint history with a tamper-evident SHA chain. Hash chain does not authenticate against a DB administrator deliberately rewriting the entire chain.
- SQLite commit precedes exporting handoff Markdown; a failed export is shown as a warning and can be regenerated with `handoff`.
- Never put secrets or raw sensitive customer briefs into task summaries, paths, decisions or external checkpoint payloads. Files under `.session-handoff/` and `data/` are ignored by Git and must be backed up securely.

## Close one session; resume in another

Export without claiming completion:

```bash
npm run session:handoff -- --task <task-uuid>
npm run session:status -- --task <task-uuid>
```

New Codex or Claude session:

```bash
npm run session:bootstrap
npm run session:resume -- --task <task-uuid> --runtime claude --version <current-task-version>
```

`resume` atomically supersedes the old session, increments task version, preserves checkpoints and returns a new `session.id`. The old session is fenced from further writes. Before continuing, check `git status`, uncommitted code, outputs and hashes. If drift exists, write an explicit corrected milestone/invalidation using a supervised reconciliation process; auto-resume is **blocked**, not secretly repaired.

When complete, checkpoint with no `inProgress`, no `next`, no `risks`, at least one evidenced completed step and no FAIL check; then:

```bash
npm run session:finish -- --task <task-uuid> --session <session-uuid> --version <current-version> --confirm
```

## Files exported to `.session-handoff/`

- `TASK_LEDGER.md`: project-wide task status index
- `HANDOFF.md` and `PROJECT_STATE.json`: most recently exported active task (convenience pointers; with multiple tasks choose by ID)
- `<taskId>/HANDOFF.md`, `PROJECT_STATE.json`: authoritative export snapshot **of a committed DB checkpoint**
- `<taskId>/DECISIONS.md`, `PROGRESS_LOG.md`, `NEXT_ACTIONS.md`, `TEST_RESULTS.json`
- `<taskId>/SESSION_HISTORY/<sessionId>.json`: chronological session checkpoint history

The files are disposable read-only projections. Regenerate them from SQLite. Do not modify projections by hand; they are not imported back into the DB.

## Context-window and lifecycle safety

- **Hard guarantee:** each successful `checkpoint` persists transactionally to SQLite. No guarantee of capturing work that was never checkpointed.
- **Hooks (best effort):** `.claude/settings.json` supplies `SessionStart`, `PreCompact`, `Stop`; `.codex/hooks.json` supplies `SessionStart`, `PreCompact`, `SessionEnd`. Hook script `scripts/session-hook.mjs` reads lifecycle metadata only and exports **already committed** state. It does not parse AI transcripts or private chain of thought. Trust/approval/version/runtime support must be checked in each installed CLI. Project hooks execute from project root; from a subdirectory you may need an absolute path in hook configuration.
- **Explicit fallback:** run `npm run session:handoff -- --task <uuid>` before compaction, model switch, timeout or shutdown. A pre-compaction event may arrive too late to capture uncheckpointed changes; never rely on that hook alone.
- **Optional token budget:** if the runtime provides **actual** `usedTokens/maxTokens`, run `node scripts/session-continuity.mjs context --task <uuid> --file /secure/context.json`. It returns NORMAL (<70%), CHECKPOINT_NOW (>=70%) or HANDOFF_NOW (>=85%), plus a handoff snapshot. These counters are operator-provided, not automatically measured. CLI does not invent context-window sizes.

## Operations and recovery

- Same-host Node >=22.13 (built-in `node:sqlite`), local SQLite WAL; no NFS / SMB. Use `DATA_DIR` consistently for worker/server/CLI/hooks.
- Existing `npm run backup` remains valid for SQLite; back up any workflow artifact directories separately. `.session-handoff/` exports can be regenerated; do not depend solely on them. Backups should be encrypted and restore-tested.
- SQLite stores no live LLM transcript. External `sessionId` is metadata only, never an API key.
- If a process crashes between writing source and checkpoint, detect modified/missing artifacts by comparing `git diff` and expected work; explicitly reconcile. One-at-a-time session version fencing cannot prevent direct out-of-band file writes.
- Run `npm run eval:continuity` for session tests, `npm run test:serial` for regression, `npm run doctor` for preflight. Hook scripts fail open on errors to avoid blocking interactive work; fall back to manual inspection.

## Acceptance criteria

- Restart and cross-provider resume retains all committed milestones and next actions.
- Stale task version, stolen session and duplicate operation ID conflicts fail closed.
- Existing completed steps cannot disappear silently; missing/changed evidence blocks resume/finish.
- The project can have multiple tasks, but never guesses which one the user means.
- Backup/restore and remote multi-host migration remain operational responsibilities. Tests are offline and do not certify actual Claude/Codex lifecycle hook execution in this environment.

**Trade-off:** additional SQLite writes and operator checkpoint discipline vs. reliable resume. **Edge case:** text output without a saved checkpoint cannot be reconstructed after a hard context truncation.
