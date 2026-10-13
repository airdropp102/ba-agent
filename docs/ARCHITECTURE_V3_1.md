# BA Studio v3.1 — Hardened Single-Agent Harness

## Scope

Input: customer brief (text), human-sourced clarifications, optional analyst notes.
Output: versioned BA canonical package, DRAFT BRD/SRS, questionnaire, safe HTML click-through prototype, optional Figma design pack and human-operated MCP publishing.

BA Studio is primarily Codex CLI / OpenAI Responses; Claude Code **can consume the portable BA skills** but this package **does not** implement a Claude CLI/API runtime adapter. MCP is shared tooling protocol, not an interchangeable model provider.

## Five subsystems (smallest architecture)

```text
  User / BA review
        |
  Node.js API / state machine  <----- Instruction: AGENTS.md + skills/ba-*
        |
  [DEMO | Codex CLI | OpenAI Responses]  (one provider per invocation)
        |
  Shared schema guard -> source/evidence trust -> BABOK quality checks
        |
  Local project JSON, version snapshots, stable FR/NFR/BR/Q IDs
        |
  Reviewed canonical -> BRD / SRS / HTML prototype
        |
  Explicit operator -> design pack -> Codex + TalkToFigma MCP -> Figma
                                     | agent-reported node verification |
```

1. **Instruction**: `AGENTS.md`; portable BA skills; `src/openai.js` loads approved BA policy text. Skills in Node are *instructions*, not independently invoked agents.
2. **Tool**: `src/ai-provider.js` abstracts analysis/prototype; `src/codex-provider.js` and `src/openai.js` return the same JSON contract; `src/model-output.js` guards both. Figma changes use Codex and TalkToFigma MCP only after explicit `--publish`.
3. **Orchestration**: one sequential pipeline with BA human review gate. No multi-agent worker queues, retry loops or background jobs. A per-project in-process lock is acquired **before** filesystem reads on all POST project mutations.
4. **State/memory**: local JSON canonical data, immutable history snapshots, stable requirement IDs, and file-specific verified-by-agent Figma registry. `If-Match` provides optimistic version checking; `REQUIRE_IF_MATCH=true` makes it mandatory.
5. **Guardrails & evaluation**: source attribution + quote matching; no analyst-only confirmation; bounded structured output; deterministic quality checks; no automatic customer approval; `npm test` and `npm run eval` (offline guardrails).

## API state transitions

```text
NEW --analyze--> ANALYZED --review--> REVIEWED --generate--> GENERATED
                     ^                               |
                     |-------- analyze/clarify/answers (invalidate review + prototype)
```

- `review` means **BA reviewed**, not customer approval; outputs are DRAFT.
- `generate` requires BA review. BRD/SRS exports require BA review; canonical/questionnaire exports do not.
- Changed requirements keep IDs only on conservative semantic matches. Ambiguous merges require analyst reconciliation; not semantic certainty.
- Figma publish records node IDs only after a structurally accepted agent report; **not independently verified** by an outside service. Changed/deleted nodes on the Figma side require manual reconciliation, optionally `--force` recreation.

## Operational runbook

```bash
npm run setup                   # creates .env only if missing; preflight demo by default
npm run setup:start             # same, then launches local web server in foreground
npm run setup -- --install-skills=both  # optional, explicit install for Codex + Claude Code
npm run doctor                  # verify configured provider + locality
npm run doctor:figma            # optional Figma tool availability (not live session)
npm test                        # offline unit/integration regression
npm run eval                    # six deterministic guardrail benchmark cases
```

For LIVE backend set `DEMO_MODE=false`, `AI_PROVIDER=codex|openai`; run doctor again. See `setup.md` for login/configuration and `docs/figma-handoff.md` for Figma risks.

## Concrete quality bar

| Metric | Measurement | Local acceptance | Limitation |
|---|---|---|---|
| Regression test pass | `npm test` | All pass | Does not test real LLM/Figma |
| Offline guardrail success | `npm run eval` | 100% of six fixtures | Not a benchmark of semantic analysis accuracy |
| Write-conflict correctness | concurrent analyze test, optimistic version test | Exactly one successful mutation for competing same-version writes | Lock covers one Node process, not multiple replicas |
| Provider output safety | shared schema check + max serialized output 2MB | Invalid schema/oversize fails closed | Does not detect semantic hallucination |
| Figma report integrity | duplicate/unknown/reused node IDs rejected | No reused or duplicate accepted node ID | Agent's `verified` flag cannot prove visual correctness |

## Trade-offs and risks

- **Simplicity over scalability:** JSON file store + single process is easy to inspect; no transactional DB or distributed lock. Do not run multiple server instances sharing `DATA_DIR`. Use a transactional DB if concurrency matters.
- **Fail-closed over throughput:** bounded output schema can reject unusually verbose but valid responses; revise limits with corpus-backed tests, not guesswork.
- **MCP is an external action boundary:** Codex `read-only` shell does not prevent side effects through a connected Figma MCP tool. Keep operator authorization, no unattended auto-publish.
- **Prompt injection:** customer content remains untrusted; output schema and source-check guards limit some failures but cannot prove model followed instructions. Manual review and semantic evaluations remain required.
- **Privacy:** customer data can leave the machine in LIVE modes; keep local bind, permissions and explicit data processing consent.

## Next engineering priorities (not implemented in v3.1)

1. Live BA corpus (30+ diverse briefs), gold labels, precision/recall of FR extraction, NFR evidence accuracy, hallucination rate, and P95 latency/cost by provider.
2. Persistent run state, source-span offsets, human reconciliation UI, deterministic impact graph, and structured contradiction detection.
3. Figma idempotency with live file identity verification, node-existence check, abort/recovery ledger and human screenshot review before registry commit.
4. Optional Claude provider through a separate adapter that produces the **same canonical schema**, not duplicated BA logic; shared third-party integrations should remain MCP servers.
5. Production hardening: transactional store, HTTPS auth/RBAC, audit and retention policies, structured secret-safe telemetry, backups.
