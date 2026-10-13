# BA Studio v3.7 — Recommendation-Assisted Gap Analysis

## Goal

Produce actionable, tech-stack-aware alternatives when BA/Customer clarification is needed, without replacing the human decision maker. The project still uses a single-agent provider (demo/OpenAI/Codex), and all state persists in the shared SQLite source of truth with per-project workspace projections. **No new MCP server required**: the feature uses existing in-process AI tool calls and HTTP API. MCP remains the shared integration layer for future sources of approved architecture documents and external evidence.

## Process

1. **Declare project stack**: Operator adds real technologies (`frontend`, `backend`, `mobile`, `database`, `infrastructure`, `integrations`, `constraints`) in Analysis → Tech Stack, or `POST /api/projects/{id}/tech-stack`. No automatic inference. Unknown stack prevents recommendations.
2. **Generate drafts**: Run the Gap Analysis stage in the normal workflow; when stack is configured it generates AI recommendations, or click **AI đề xuất phương án** in Analysis. There are 1–3 alternatives for each covered open question, each with benefits, trade-offs, implementation verification, stack references, and an optional recommendation. Business-policy choices may have *no preferred option*.
3. **Human selection**: BA/operator picks an **exact** option ID, authority (`ba` or `customer`), rationale, document reference, and (for customer role) the approving customer representative. `customer` here is **operator-attested**, not independent identity verification. The selected option becomes a persisted **answered clarification**, not a signed BRD/SRS baseline.
4. **Reconcile**: A decision makes `requirementsRefreshPending=true`, clears earlier BA Review and prototype, and invalidates dependent workflow checkpoints. The system will re-run elicitation during the next Gap Analysis workflow pass or an operator can press **Re-analyze**; the accepted answers are passed as attributed decisions, not as unqualified customer statements. BA Review/export must not proceed while refresh is pending.
5. **Review deliverables**: Regenerate PRD/BRD/SRS/prototype after BA Review. Each document has a `Technology-aware clarification decisions` appendix. Customer evidence provenance and uncertainty in FR/NFR remain unchanged unless independent source-grounding validates the revised requirement.
6. **Audit/history**: Accepted decisions and obsolete versions remain in SQLite history and `09-archive`; current state is projected to `02-requirements/clarification-recommendations.json` and `00-admin/TECH_STACK.json` inside the project's workspace.

## Endpoints

`POST /api/projects/:id/tech-stack`:

```json
{"techStack":{"frontend":["React"],"backend":["Node.js"],"database":["PostgreSQL"],"mobile":[],"infrastructure":[],"integrations":[],"constraints":["On-premise required"]}}
```

`GET /api/projects/:id/recommendations` returns project tech stack, proposals, and recorded decisions.

`POST /api/projects/:id/recommendations/generate` generates drafts based on the latest analyzed questions and configured stack. In demo mode it uses deterministic, explicitly labeled templates rather than real model inference.

`POST /api/projects/:id/recommendations/approve`:

```json
{"questionId":"Q-001","optionId":"OPT-Q-001-1","approverRole":"ba","sourceReference":"ADR-025 / BA workshop 2026-10-13","rationale":"Reuses existing permissions middleware and avoids duplicate identity infrastructure."}
```

For `approverRole:"customer"`, also include `customerRepresentative:"Person who approved"` and verifiable documentation in `sourceReference`. All project mutation endpoints support the existing `If-Match: <project version>` CAS strategy. An option from another project, a stale question/stack, or an unconfigured stack is rejected; role authority is attested by authenticated reviewer token if configured. Local unauthenticated mode is not sufficient for externally verifiable approval.

## Guardrails and limitations

- AI suggestions are draft choices, **not** `sourceEvidence`, not customer consent, not a guaranteed correct technical design. A selected answer only resolves the associated clarification; it cannot magically satisfy unrelated gaps or create testable NFR metrics.
- Human approval is recorded with actor, chosen option, role, source/reference, rationale, question digest, and stack digest. Source references are attestations, not automatically verified originals. `customerBaselineApproved` always remains false.
- Changing tech stack invalidates active recommendations and marks recorded decisions stale. Accepted responses never survive stale question/stack checks as an active resolution.
- At-least-once AI execution means provider calls can be repeated after worker crash. Review token identity and external document provenance need a configured auth/evidence service for high-trust production workflows.
- Costs and latency depend on AI provider and number of open questions. OpenAI/Codex live model behavior is **not validated** by the offline test suite.

## Validation

Run `npm run eval:recommendations` and `npm run test:serial`, then `npm run doctor`. For live acceptance, configure real provider credentials and run an operator-approved test corpus containing decisions with matched tech stacks. Recommended metrics: >=95% proposal-to-stack reference accuracy, >=98% stale decision rejection in tests, >=90% BA-rated usefulness across at least 30 reviewed questions, no unauthorized automatic approvals. These are targets, **not** measured live outcomes.

## Clarification UI update (2026-10-13)

The Analysis UI now presents full-width collapsible questions, priority/status filters, inline sourced customer responses, and explicit option approval forms. The Tech Stack editor is removed from the UI; stored stacks and manual APIs remain compatible.

Use `POST /api/projects/:id/recommendations/generate` with `{ "mode":"business", "questionId":"Q-001" }` for opt-in business-answer drafts without a declared stack. Business mode requires empty `stackReferences`, labels feasibility UNKNOWN, and never recommends an automatic selection. Unknown question IDs reject. Generating for one question preserves other current proposals. Default/technical mode retains the original declared-stack/candidate requirement. Exact option selection still requires authority, evidence and rationale, invalidates review and sets `requirementsRefreshPending`.

The UI distinguishes custom customer-attributed answers from BA/customer-attested proposal approval. Neither establishes customer baseline sign-off. No external generation occurs merely by opening the form.

## Batch clarification update (2026-10-13)

The UI can request suggestions for all unanswered questions in groups of three, report completed/failed question counts, and retry failed groups. `recommendations/generate` accepts `questionIds` (1–5 unique open IDs) in explicit business mode; a partial provider response fails that group. Other proposals remain intact.

Project-scoped in-memory drafts survive filtering, collapsing questions and re-rendering. They do not survive closing/reloading the page. No option is automatically selected. Changed question/proposal digests require selection again rather than silently approving new option text.

`POST /api/projects/:id/answers/batch` accepts `{ "answers": [...] }`, with 1–100 unique question IDs. Each item has `kind:"custom"` with answer/respondent/sourceReference, or `kind:"option"` with exact optionId/approverRole/sourceReference/rationale and customerRepresentative when applicable. All entries validate against one current project snapshot before committing. Custom answers remain customer-attributed text; BA choices remain attested decisions, not customer sign-off. Mixed batches bind newly authorized decisions to the resulting brief and invalidate previous review and dependent artifacts. Existing manual endpoints are unchanged.

Save does not call AI. It sets `requirementsRefreshPending=true`; continue the normal workflow or re-analyze once before BA Review/export. Invalid batches leave the persisted project unchanged. Optimistic versioning and lease guards remain authoritative. Workflow cards localize status and distinguish current-step and total-job elapsed time; active animation honors reduced-motion and stops at human gates.
