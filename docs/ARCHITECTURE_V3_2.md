# BA Studio v3.2 — Intelligent BA Workflow (implemented)

## Goals / non-goals

A **single-agent**, local-first BA harness that automatically moves through Brainstorm → Elicitation → Gap Analysis → Clarification → BA Review → Deliverables → Figma Design Pack. Preserves human gates and previous `analyze`, `answers`, `review`, `generate`, `export` routes. No source-code generation, no customer auto-approval, no claim of remote Figma publication without verification.

## Architecture

```text
Customer brief / customer responses
  └─ HTTP UI + versioned project lock + If-Match
      └─ Workflow driver (src/server.js + intelligent-workflow.js)
          ├─ BRAINSTORM      structured hypotheses from Codex/OpenAI/DEMO
          ├─ ELICITATION     existing normalized extraction + source evidence
          ├─ GAP_ANALYSIS    deterministic BABOK gaps + QA metrics
          ├─ CLARIFICATION   WAIT if High; customer replies or explicit BA risk acceptance
          ├─ BA_REVIEW       WAIT for actual human acknowledgement
          ├─ DELIVERABLES    draft BRD/SRS, canonical, prototype
          └─ FIGMA_DESIGN    durable design pack + per-FR coverage and publish plan
                └─ FIGMA_PUBLISH (WAIT for optional external Codex + Figma MCP)
                    └─ sync verified-node registry; operator performs visual QA
```

Node.js owns one JSON writer per project, with atomic rename and `.history` snapshots. Every dispatched workflow stage writes a `RUNNING` intent **before** invoking AI or writing output, then checkpoint + completion after successful step. A `FAILED` or abandoned `RUNNING` stage is resumed by an explicit new `POST /workflow/advance`; no background worker. A model call that completes before a crash but before committing its checkpoint may be repeated/billed twice. Workflow execution is not a distributed transaction.

Tools: OpenAI Responses/structured outputs or Codex CLI structured schema. Claude Code has portable BA Skills only; there is **no Claude runtime adapter**. Figma is isolated behind an operator-triggered Codex CLI + TalkToFigma MCP connector so Claude/Codex integration can reuse an MCP service without duplicating a provider-specific Figma tool. HTTP workflow/API remains platform-neutral. No automatic MCP file changes happen in an advance call.

## Workflow state contract

`project.workflow`:

```json
{
  "schemaVersion":"ba.workflow.v3.2",
  "runId":"<uuid>",
  "stage":"CLARIFICATION",
  "state":"WAITING_CLARIFICATION",
  "platform":"web",
  "checkpoints":[{"stage":"BRAINSTORM","completedAt":"<iso>","inputDigest":"<sha256>"}],
  "attempts":[{"id":"<uuid>","stage":"BRAINSTORM","result":"SUCCEEDED"}],
  "waiver":null,
  "lastError":null,
  "artifactDir":null
}
```

State values: `READY`, `RUNNING`, `FAILED`, `WAITING_CLARIFICATION`, `WAITING_BA_REVIEW`, `BLOCKED_NO_FUNCTIONAL_REQUIREMENTS`, `AWAITING_FIGMA`, `FIGMA_REPORTED`.

Human gate rules:

1. Brainstorm result `DRAFT_HYPOTHESES` cannot overwrite customer evidence or become a confirmed FR by itself.
2. Only customer-brief or attributed customer-response evidence permits certainty `confirmed` (still not signed off). Answers reset downstream stages from `GAP_ANALYSIS`, invalidate waivers, design packs and human review.
3. High findings/questions stop at `CLARIFICATION` until changes reduce blockers or BA explicitly accepts **all** current blocker IDs with a 20–3000 char written rationale. The waiver binds to both analysis digest and blocker-list digest, invalid after any relevant change. The UI shows all high blockers and confirms acceptance.
4. BA Review is a separate, explicit human endpoint, not a customer approval. It is required even if there are no high issues. `canonical.review.customerApproved` remains false and baseline status remains `NOT_BASELINED`.
5. Figma Design augments missing prototype-to-FR mappings with a conservative **DRAFT screen candidate** (heading + existing FR description; never invented business behavior). Coverage must include every current FR; packs are written under `data/.workflow-artifacts/<project-id>/<runId>` with mode 0600 files.
6. Figma sync can only read a *file-scoped* node registry produced by the existing CLI verification path and verify screen hashes against the current pack. A digest of reviewed business context/requirements also enters each screen fingerprint, so changed FR/NFR/BR content invalidates old design-node claims even when a screen label has not changed. Success is labeled `REPORTED_VERIFIED_PENDING_VISUAL_QA`, not independently verified drawing quality, native interactions, or customer acceptance. Operator must inspect live file.

## HTTP interface

For all POST mutations, use `Content-Type: application/json`, and when configured, an `If-Match: "<current-project-version>"` header. Standard revision locks prevent same-process mutation overlap. Old standalone endpoints stay available for legacy/manual flows.

| Endpoint | Purpose / state |
|---|---|
| `GET /api/projects/:id/workflow` | Current workflow, quality snapshot, blockers, brainstorm |
| `POST /api/projects/:id/workflow/advance` | `{ "auto": true, "platform":"web" }`; auto-runs to first human/external gate; `auto:false` runs ≤1 stage |
| `POST /api/projects/:id/workflow/waiver` | `{ "blockerIds": [...all high IDs], "rationale":"..." }`; current scope only |
| `POST /api/projects/:id/review` | `{ "approved":true, "notes":"..." }`; explicit BA approval |
| `POST /api/projects/:id/answers` | Answer + respondent + sourceReference; re-elicitation and invalidation |
| `POST /api/projects/:id/workflow/figma/sync` | `{ "documentKey":"figma-file-key" }`; verify registry coverage; no drawing |
| `POST /api/projects/:id/workflow/restart` | `{ "confirm":true, "platform":"mobile" }`; reset BA review + prototype, new run ID, keep sources/IDs/history |

Figma actual draw: `node scripts/figma-design.mjs --project UUID --platform web --publish --channel CHANNEL --figma-file FILE_KEY`. Codex must already have MCP and Figma plugin connectivity. This action is **never** implicitly invoked by the web `advance` endpoint.

## Measurement / evaluation

- `npm test`: unit + HTTP integration, offline harness contracts, crash/restart behavior.
- `npm run eval` → six deterministic v3.1 guardrails.
- `npm run eval:workflow` → workflow-specific integration and failure-mode tests.
- `npm run eval:semantic` → `eval/ba-gold-v1.json`: five synthetic cases, keyword-concept recall/precision proxies + evidence quote grounding. DEMO expected low recall for unrelated briefs; do not label this actual semantic accuracy or LLM benchmarking. For configured live provider use `DEMO_MODE=false AI_PROVIDER=codex npm run eval:semantic -- --live` (model cost applies); a human-labeled corpus of ≥30–50 varied cases remains future work.
- Useful KPIs for future live evaluation: FR precision/recall per stakeholder-labeled example, quote grounding ≥99%, blocker gate bypasses =0, duplicate output checkpoints =0 after committed stages, median latency / calls per request, Figma reported-screen coverage 100% and human visual QA rate.

## Failure/edge cases and trade-offs

- **Reliability vs. latency:** one locked HTTP operation runs several sequential model calls. Large briefs may take time; the client can poll GET endpoints while `RUNNING`. The request may time out via an upstream proxy. Resume explicitly; avoid auto-retrying payments blindly.
- **Single-process file storage:** only one server instance may write a `DATA_DIR`. Cross-process locks/SQL durability, backup/retention, OAuth/RBAC, secret-safe logs, and authenticated identity for BA waiver are **not** implemented.
- **Source trust:** an analyst note never becomes confirmed source evidence. Quote matching establishes text grounding, not truth or signature. Prompt-injection can still affect model text; deterministic validation mitigates false confirmations.
- **Figma:** MCP node IDs are accepted from operator's structured report, not independently cross-checked with Figma server at API sync time. Partial remote mutation may occur even if CLI fails. Never force-create without manual inspection. No guaranteed native interactive prototype connections.
- **Cost:** Brainstorm and elicitation are two separate provider calls; prototype is another after BA Review. `auto` stops at quality gates, avoiding unreviewed downstream provider spend. Human gates reduce hallucination risk but require decisions.
