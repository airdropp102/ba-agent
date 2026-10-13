# v3.5 Changes (2026-10-13)

- Added `src/session-continuity.js`: transaction-backed task/session/checkpoint ledger and migration marker 5 on existing SQLite WAL.
- Added `scripts/session-continuity.mjs`: bootstrap, new, checkpoint, resume, verify, handoff, history, context thresholds and finish.
- Added `scripts/session-hook.mjs`: best-effort `SessionStart`, `PreCompact`, `Stop` / `SessionEnd` hook handler, no transcript ingestion.
- Added `.claude/settings.json`, `.codex/hooks.json`, `CLAUDE.md`, `SETUP.md`; updated `AGENTS.md`, `setup.md`, `README.md` and npm scripts.
- Added version-CAS ownership fencing and operation ID idempotency, append-only hash chain, SHA-256 artifact integrity/drift, explicit step invalidation, safe local path policy.
- Added per-task Markdown/JSON handoff export, decisions, progress, next actions, test results and session histories (generated from SQLite).
- Added 14 automated tests, including restart, tampering, drift, multi-connection fencing, hook and full lifecycle. Current serial regression: **90/90 PASS**.
- Preserved v3.4 live acceptance implementation and all existing API routes. No external MCP/Claude/Codex interactive session attested in this release.
