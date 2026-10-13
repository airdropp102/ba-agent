# BA Studio v3 — Change Log (2026-10-13)

## Added

- Backend AI provider switch: `demo` / `codex` / `openai`, Codex CLI with ChatGPT login, bounded subprocess execution, strict local JSON checking, no shell.
- Version snapshots to `data/.history/<project>/vN.json`, requirements changeLog and optimistic optional If-Match + per-process mutation lock.
- Source records with separate customer brief, BA note, and sourced customer answers; customer Q answer API and UI. Sources represented by hashes/metadata in canonical export; full text remains in project data/history.
- Stable ID matching across FR/NFR/BR/Q as well as prototype screens; conservative matching and monotonic ID allocation.
- Figma publishing plan, SHA-256 per screen, file-key-scoped registry and structured Figma report checks. Unchanged registered screens are skipped, changed ones planned as new frames without deleting old frames.
- Local-by-default security; external bind fails without BA_STUDIO_TOKEN; API bearer auth on external bind; same-origin POST guard; no-store downloads.

## Modified

- `setup.md`, `.env.example`, `README.md`, `docs/figma-handoff.md`, `AGENTS.md`, browser UI with provenance panel and sourced answers.
- BA quality verification still requires human review and never marks customer-approved automatically.
- Figma publish CLI now requires `--figma-file` when `--publish` is supplied; **breaking change** for old automation scripts, intentional to prevent writing registry under an ambiguous target.

## Compatibility and migration

New ZIP contains a fresh project directory `ba-agent-mvp`. To preserve your v2 workspace:

1. Stop the old Node server. Back up your old project directory and especially `data/`.
2. Unzip v3 to a different directory. Copy your old `data/` into v3 before launch; retain old ZIP backup. Do not copy previous `.env` without reviewing new `AI_PROVIDER` behavior.
3. Existing project JSON without `sources` remains readable; old combined brief cannot always distinguish actual customer statements from analyst amendments. On first review, reconcile any questionable evidence before treating it as confirmed.
4. Run `npm test`; start with `DEMO_MODE=true`, then configure Codex/OpenAI. Retest Figma and use `--figma-file FILE_KEY`.

## Verification

`npm test`: 26/26 passing on Node.js 22 in this environment. Includes fake-Codex CLI process, local HTTP API integration, stable identity, provenance, fake Figma registry and offline Design Pack. No live ChatGPT/Codex login or Figma MCP connection was used for these tests.

## Outstanding work

- Database + tenant-aware RBAC and audit immutability; production HTTPS and secret management.
- Better fuzzy/semantic identity reconciliation with BA confirmation when requirements are genuinely renamed/re-scoped.
- Cross-artifact impact diff, UI journey grouping and reusable Figma design component library.
- Live Codex and Figma E2E smoke tests, independent visual validation and native Figma prototype linking where supported.
