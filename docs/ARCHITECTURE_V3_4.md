# BA Studio v3.4 — Production Validation & Quality Intelligence

## Scope and architecture

Preserves the **single BA agent** of v3.3, plus SQLite WAL storage and lease-fenced jobs. It does **not** create a new multi-agent orchestrator or replace the Figma operator. Codex CLI and OpenAI Responses API are existing backends; Figma MCP is the reusable external tool boundary.

```text
Intake → Brainstorm → Elicitation → Gap/Clarification → BA Review
                                   │                         │
                                   └──── deterministic QA ────┘
                                             │
               SQLite quality snapshots ←─ quality gate (opt-in)
                                             │
                           BRD/SRS/Prototype → Figma Pack → MCP operator
                                                            │
                                                   Figma contract probe
                                                            │
                                            scoped read-back + BA visual QA

Codex CLI / OpenAI calls → request-scoped usage hook → SQLite AI ledger → metrics UI
                                               │
                                     operator price catalog (optional)
```

## 1. Quality Intelligence: measurable but not semantic correctness

`src/quality-intelligence.js` computes a deterministic weighted score (0..1) from:

| Criterion | Weight | Evaluation rule |
|---|---:|---|
| Customer-text-grounded confirmed FR/NFR/BR | 25% | Confirmed items require verifiable contiguous quote in a trusted customer source, never analyst notes |
| FR actor presence | 15% | Every functional requirement has an actor |
| FR acceptance-criteria presence | 20% | Every FR has at least one nonempty AC |
| FR → business goal traceability | 15% | Goal matches an existing named business goal |
| BRD/SRS FR ID presence | 15% | Every FR ID is present in both generated documents |
| NFR measurable-target presence | 10% | Each NFR contains a non-placeholder target |

Dimensions with zero applicable records are marked `null` and excluded, **not scored as 100%**. Zero FR is always `BLOCK` with score `null`. Fake confirmed evidence or missing document trace is an unconditional `BLOCK` independent of numeric score. A high-quality numeric score can still be `REVIEW` when High clarification questions are unwaived, BA Review is missing, or measured score is below the configured minimum. Customer signature is **never** inferred.

`BA_QUALITY_MIN_SCORE=0.8` defines the proxy cutoff. `BA_QUALITY_ENFORCE=true` **opts in** to stopping the automatic v3.4 workflow at DELIVERABLES with `WAITING_QUALITY_REVIEW`. Corrections need a legitimate updated requirement/source, review and resume (or a fresh workflow run); the system never fabricates missing evidence. Existing legacy manual endpoints remain compatible and are not a replacement for the stricter workflow quality gate.

Every meaningful analysis/review/prototype change persists a deduplicated `quality_snapshots` row **inside the same SQLite transaction** as project/audit, so rollback cannot leave orphan quality history. `src/server.js` exposes:

- `GET /api/projects/:id/quality` — current rubric, errors, score, policy, digest
- `GET /api/projects/:id/quality/history` — prior scores, versions and findings, 50 latest
- `GET /api/projects/:id/quality/ai` — per-project AI ledger aggregation
- `GET /api/metrics` — job metrics plus global AI ledger aggregation

The browser Workflow tab shows the four main rubric metrics, findings, history, token usage and known-cost limitations. No AI requests are made to compute these scores; results do not certify domain meaning, GDPR/PDPA compliance, accessibility or visual correctness. Simple FR ID presence in Markdown is a traceability **proxy**, not a formal parsed cross-reference.

## 2. AI usage and FinOps telemetry

`src/ai-telemetry.js` uses `AsyncLocalStorage` to associate a provider operation with project, run, stage and request duration; it writes one `ai_invocations` row even for failed calls. It **does not store prompts, completions, API keys, customer briefs or response text** in this ledger.

- OpenAI Responses API: reads provider-returned `usage.input_tokens` and `usage.output_tokens`; do not estimate missing data.
- Codex CLI: the current structured `--output-last-message` execution does not provide a verified token usage payload. **Token counts and USD remain null**, even if CLI activity consumes capacity.
- DEMO: records call counts and elapsed time, but never fabricates tokens or prices.
- To calculate estimated USD, operator sets an approved `BA_AI_COST_RATES_JSON` dictionary of `{model: {inputPerMillionUsd, outputPerMillionUsd}}`. Unpriced calls stay **unknown**, not $0. No default vendor prices are bundled; pricing and contracts may change.
- `BA_AI_ALERT_RUN_USD` marks a *known-cost threshold exceeded* in `byRun`, **not a hard budget**: it cannot predict an in-flight call or prevent usage without provider-native hard caps. `p95LatencyMs` is computed from up to 10,000 most recent invocations in scope and is labeled with sample size.

All job retries and repeated provider invocations create separate ledger rows, intentionally measuring at-least-once overhead. The ledger is local and requires ordinary database-backup and retention controls; it is not a distributed tracing platform or independently reconciled billing invoice.

## 3. Benchmark / CI quality release gate

`npm run eval:quality` runs deterministic DEMO on the existing **5 synthetic, keyword-labeled** `eval/ba-gold-v1.json` records. Flags:

```bash
npm run eval:quality -- --out reports/quality-offline.json
npm run eval:quality -- --min-fr-recall 0.8 --min-grounding 1  # nonzero exit if failed/unknown
DEMO_MODE=false AI_PROVIDER=openai npm run eval:quality -- --live --corpus /secure/labeled-gold.json --out /secure/reports/run.json
```

The same corpus format accepts actual expert-annotated BA cases via `--corpus`. Schema requires case ID, title, brief, `expectedFunctional` and `expectedNfr` (each list is a list of alias arrays). For real release decisions, separately record reviewers, domain, annotation agreement, privacy approval, false-positive/hallucinated features, revision, model/prompt versions and representative stratified samples. An empty gold dimension returns `null`, and a configured threshold against `null` **fails closed**. Corpus alias matching is a **keyword-concept proxy**, not a replacement for independent BA judgment. The DEMO benchmark is intentionally inadequate for production promotion.

## 4. Figma MCP contract

`npm run eval:figma-contract` executes 1 positive + 4 negative offline read-only probe fixtures. `src/figma-mcp-contract.js` rejects mismatched file key, node ID/name/type, missing document/frame read, or missing expected `get_document_info` / `get_node_info` (or `get_nodes_info`) tool family. This test validates the **reported output contract**, not a live MCP session.

```bash
# Requires Codex CLI already authenticated AND Figma MCP live session;
# only READ operations; no automatic publish.
npm run eval:figma-contract -- --live --file <FIGMA_FILE_KEY> --node <N:N> --name "Actual Frame Name"
```

Live mode invokes a read-only Codex CLI agent using the existing MCP tools and the structured schema; if the plugin/tool/session cannot provide read-back, the command must fail instead of claiming success. It is still **operator-reported evidence**; Codex can misreport tool execution and the Figma endpoint does not cryptographically attest the JSON. v3.3 nonce-bound scoped registry + BA visual QA remain mandatory. For independent attestation, use a trusted, authenticated Figma API/MCP adapter that returns signed or server-origin evidence and record its provenance.

## 5. Testing and acceptance

- `npm test` — all regression + v3.4 tests; fixture negatives cover fake evidence, lack of FR, missing AC/actor/goals, missing review/waiver, cost unknown, concurrency-scoped telemetry, atomically rolled back quality history, read-only Figma contract and API quality gates.
- `npm run eval:v34` — v3.4 tests only.
- `npm run eval:production` — v3.3 queue/storage/recovery tests.
- `npm run eval` — legacy offline policy/guardrails.
- `npm run doctor` — confirms Node version, provider and v3.4 env policy configuration.

**Operational SLO examples (not measured on production):** grounded confirmed quotation rate >=99%, reviewer-adjudicated FR concept recall >=90% on approved corpus, quality-gate bypass count = 0 for workflow-routed deliverables, production job completion >=99%, p95 provider call latency below the team-specific SLO, zero unauthorized Figma write actions in contract-probe sessions. Choose/validate thresholds on actual business data before treating them as release gates.

## 6. Trade-offs / risk register

1. **Deterministic rubric vs LLM judge:** deterministic is fast, cheap, reproducible and safe against provider drift; cannot detect semantically false but source-matching descriptions, ambiguity or weak acceptance criteria.
2. **SQLite telemetry vs managed observability:** minimal dependency, transaction-local trend tracking; no cross-host HA, no OpenTelemetry back-end, no automated archival or tenant isolation.
3. **Operator price catalog vs billing integration:** avoids assuming dynamic vendor rates but may be stale, omit cache/discount/batch pricing and fail to account for Codex usage. USD totals are partial until reconciled against invoices.
4. **Read-only MCP contract vs full integration:** safe offline/contract-first; live checks require a configured real Figma session and cannot prove trustworthiness of agent-generated reports.
5. **Local reviewer tokens vs enterprise identity:** existing v3.3 authentication remains; add OIDC/RBAC and audit anchoring before multi-tenant deployment.

**No live provider or MCP calls are implied by passing the offline tests.** The next genuine rollout gate is a human-labeled anonymized gold dataset plus separately authorized live OpenAI/Codex and Figma probe runs.
