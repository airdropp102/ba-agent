# v3.1.0 — Harness hardening (2026-10-13)

- Fixed same-process write race: acquire project lock before asynchronous project read. Existing `If-Match` remains accepted; set `REQUIRE_IF_MATCH=true` to require it (428 missing, 409 stale).
- Added `src/model-output.js`: one bounded strict JSON subset validator for **both** Codex and OpenAI outputs; checks missing/excess properties, types, enum, array/string length, 2MB payload limit.
- Hardened `src/figma-registry.js`: reject reused/duplicate Figma node IDs, skipped-screen reports, mismatched registry scope. A `verified` boolean is still only the agent report.
- Figma publish always deletes the prior report before starting; `--force` can recreate all frames when a stale registry needs manual recovery; terminated subprocess uses SIGKILL after timeout.
- Added side-effect-free `npm run doctor` and opt-in `npm run doctor:figma` availability diagnostics. Checks actual Figma plugin/channel are manual.
- Added idempotent `npm run setup` and `npm run setup:start` (foreground), with **explicit** `--install-skills=codex|claude|both` and no overwriting existing skill folders.
- Added `npm run eval` for six offline guardrail cases, `tests/v31-hardening.test.js` for four regression cases, and architecture/operations documentation.
- No database migration, new external dependencies, automatic Figma publication, Claude runtime provider, or LIVE provider/Figma connectivity verification.
