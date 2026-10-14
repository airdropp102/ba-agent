# Codex execution progress and timeout

Run `npm run setup:start` for the local HTTP service, or `npm run worker` for a
separate worker. Logs appear in that process's terminal with `[BA Progress]`.
Logs are console-only and are not a substitute for workflow checkpoints or approval.

Configuration in the private `.env`:

```dotenv
AI_PROVIDER=codex
DEMO_MODE=false
CODEX_TIMEOUT_MS=300000
BA_LOG_PROGRESS=true
# Optional model available to the logged-in account:
CODEX_MODEL=gpt-6-sol
```

Codex defaults to 300,000 ms (5 minutes), bounded to 600,000 ms (10 minutes).
Explicit shorter timeouts remain supported. Restart the server/worker after
configuration changes. `GET /api/status` exposes the active Codex timeout and
whether progress logging is enabled. Set `BA_LOG_PROGRESS=false` to disable these
metadata logs; existing error messages remain available.

## Reading the log

- `SERVICE_CONFIG`: configured provider/model and Codex time limit.
- `ANALYSIS_INPUT`: project/run/execution IDs, source IDs, question IDs, brief
  length and answer/decision counts. No project title or answer text is printed.
- `AI_START`: invocation ID, operation, stage and configured model.
- `CLI_START`: CLI PID, prompt/schema byte counts and timeout.
- `CLI_WAITING`: every 15 seconds, elapsed time and stdout/stderr byte counts.
  A heartbeat means the process is still awaited; it does not prove the model is
  making progress or identify its internal reasoning.
- `CLI_EVENT`: allowlisted JSON event/item types from `codex exec --json`. Neither
  item text, commands, MCP arguments/results nor reasoning content is emitted.
- `CLI_EXIT`, `OUTPUT_READ`, `JSON_VALIDATE`, `OUTPUT_VALIDATED`: process exit and
  validation milestones, with output size.
- `ANALYSIS_NORMALIZE`, `ANALYSIS_EVIDENCE_CHECK`, `ANALYSIS_READY`: normalization,
  evidence checks and resulting FR/NFR/business-rule/question counts.
- `DB_SAVE_START` / `DB_SAVE_COMPLETE`: SQLite project commit. Filesystem workspace
  exports follow the commit and may still fail independently.
- `WORKFLOW_STAGE_START` / `WORKFLOW_STAGE_COMPLETE` / `WORKFLOW_STAGE_ERROR` and
  `WORKER_JOB_START` / `WORKER_JOB_COMPLETE`: workflow/queue progress.
- `CLI_TIMEOUT`, `CLI_ERROR`, `AI_ERROR`: bounded failure metadata. Raw provider
  stderr and invalid JSON/schema text are not propagated into console errors.

Project/run/execution/invocation IDs correlate concurrent work. Numeric sizes are
bytes or characters as named, not token estimates. Missing provider token usage
and pricing remain UNKNOWN (`null`) in `ai_invocations`; no prompt/completion text
is added to that ledger.

On POSIX, the CLI starts in a separate process group. Timeout or SIGTERM/SIGINT
stops that group, including launcher descendants holding pipes open. Existing
application signal handlers are preserved; otherwise normal signal termination
is restored. Windows currently uses direct-child termination, not process-tree
termination.

A failed manual re-analysis does not commit partial model output or erase prior
saved answers. Retry explicitly after checking logs; this change adds no automatic
retry and does not certify completion of an actual customer analysis within five
minutes. Offline tests and a synthetic connectivity test are diagnostic evidence,
not semantic acceptance benchmarks.
