# BA Studio v3 → v3.1 optimization report

**Date:** 2026-10-13. **Scope:** single-agent BA Studio, Codex CLI / OpenAI API analysis, portable Claude Code BA skills, Figma via MCP. This is an implementation hardening patch, not a production certification.

## 1. Executive findings

- Original baseline: **26 / 26** automated tests passed; this did not verify race safety, Figma report uniqueness, or shared output validation.
- Critical correctness issue: a project POST read JSON **before** taking its in-process write lock. A write finishing between these steps could allow stale state to be re-saved.
- Provider validation drift: Codex had a partial JSON-schema check; OpenAI relied on the structured-output API alone. The service lacked one shared local bounds/schema guard.
- Figma verification weakness: accepting a report with two screens mapped to one node ID, or a recreated screen mapped back to an old node ID, was possible. Previous output-report files also persisted between retries.
- Setup and quality measurement were documentation-heavy, without a single executable preflight or deterministic guardrail evaluation command.

## 2. Implemented patches

| Category | Change | Validation |
|---|---|---|
| Orchestration/state | Lock project *before* asynchronous read; optional mandatory If-Match (`REQUIRE_IF_MATCH=true`) | Concurrent analyze and stale-version HTTP tests |
| Model output | Shared `src/model-output.js`, schema validation + 2MB cap + array/string bounds | Invalid type, extra property, huge array/string tests |
| Figma/MCP | Reject duplicate/recycled node IDs, unrequested skipped-screen reports and registry mismatch; delete stale report before publishing; `--force` recreate for operator recovery | Figma registry regression test |
| Environment | `npm run setup`, `npm run setup:start`, `npm run doctor`, `npm run doctor:figma`; optional BA skill install for both Codex and Claude | Idempotent setup confirmed; existing skills preserved |
| Evaluation | `npm run eval` covers six offline deterministic guardrails | 6/6 passed |
| Documentation | `docs/ARCHITECTURE_V3_1.md`, `docs/CHANGELOG_V3_1.md`, updated setup/README/AGENTS | Linked in project README |

## 3. Tested result

- Original tests: **26/26**.
- v3.1 tests: **30/30**.
- Offline deterministic guardrail evaluation: **6/6 (100%)**.
- Preflight in DEMO mode: **PASS**.
- Optional skill-install command: installed 8 skills for Codex + 8 for Claude Code in isolated test home; second install preserved existing files.
- No real Codex/Figma/Claude sessions were tested, and OpenAI API was not called. Results should not be interpreted as LLM requirement-extraction precision, Figma visual correctness, or production readiness.

## 4. Target architecture

```text
Customer brief / sourced clarifications
           ↓
Single BA orchestrator (Node.js, local)
  ├── Instruction → AGENTS.md + portable BA Skills
  ├── Provider → DEMO | Codex CLI | OpenAI Responses
  ├── Guardrails → bounded schema + quote/source trust + quality gate
  ├── State → versioned JSON + snapshots + mutation lock
  └── Human BA Review → DRAFT BRD/SRS + prototype
                                 ↓ explicit publish only
                        Codex → TalkToFigma MCP → editable Figma
```

No new multi-agent architecture: there is not yet evidence that additional agents improve BA task success more than they add latency and cost. Keep MCP for shareable integrations. Claude Code loads portable BA skills, but no Claude runtime provider exists in this package; that requires an adapter plus live validation.

## 5. Remaining engineering debt / proposed priorities

| Priority | Work | Expected measurement | Risk |
|---|---|---|---|
| P0 (production) | Replace file writes with transactional DB or exclusive process ownership and durable runs | Lost updates = 0 under multi-process load | Multi-instance writers currently unsupported |
| P0 | HTTPS + real authentication, retention, backups, secret-safe logs | Security tests and restore drill | Token alone is not a production auth system |
| P1 | Gold corpus with 30+ BRD-style inputs, contradiction/PII/prompt-injection cases | FR precision/recall, NFR evidence accuracy, hallucination rate | Schema correctness ≠ semantic correctness |
| P1 | Verify live Figma file identity, existing nodes, and partial-publish recovery before registry commit | Duplicate frames per retry = 0, FR-to-frame coverage | Figma agent reports are not independent proof |
| P1 | Human identity reconciliation for renamed/merged FRs, persisted question resolution | Traceability orphan rate = 0 after revisions | Conservative auto-matching may split IDs |
| P2 | Claude native adapter behind existing schema contract | Accuracy/latency/cost vs Codex on same benchmark | Differences in CLI/API schema/stream lifecycle |
| P2 | MCP ingestion for Drive/meeting notes/issue tracking (if needed) | Correct tool selection and source attribution | Permissions and data exfiltration |

## 6. Commands

```bash
npm run setup
npm run setup:start
npm run setup -- --install-skills=both
npm run doctor
npm run doctor:figma
npm test
npm run eval
```

`--install-skills=both` changes user-scope skill directories **only when explicitly requested**, and does not overwrite existing skill folders. The web server starts in foreground. A Figma live socket/plugin must still be started separately. `--force` on `scripts/figma-design.mjs` requires manual inspection before use because it can create duplicate historical frames.
