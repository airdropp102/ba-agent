# BA Studio v3.7 — Release handoff / session continuation

Release: **v3.7 Recommendation-Assisted Clarification** (2026-10-13). Baseline: `v3.6-multi-project-workspaces`. This release is source-only; runtime `data/` and credentials intentionally excluded.

## Completed in v3.7

- Introduced explicit per-project tech stack configuration in the Analysis UI and API.
- Added structured, provider-neutral (OpenAI/Codex/demo) recommendation generation for open questions with 1–3 options, a recommended option when justified, benefits, trade-offs, implementation, and verified references to project technologies.
- Integrated recommendation generation into the durable `GAP_ANALYSIS` stage with an on-demand generation endpoint.
- Added human approval with exact selected option ID, BA-vs-customer authority, customer representative attestation, rationale, source reference, digest fencing, immutable audit/history and project-scoped projection.
- Added requirements refresh gate, normalized accepted decisions for new analysis, invalidated previous BA review/prototype/workflow checkpoints, and kept unverified customer facts blocked.
- Updated PRD/BRD/SRS/questionnaire/canonical projections and project workspace files.
- Updated shared Codex/Claude agent instructions, BA skill, setup, docs, README, and new regression tests.

## Verification evidence (offline)

- `npm run test:serial`: **109/109 PASS**, new tests **9/9**.
- `npm run doctor`: PASS with AI price catalog WARN (operator prices not configured).
- `npm run eval`: guardrails PASS, offline only.
- `npm run eval:quality`: PASS offline.
- `npm run eval:figma-contract`: 5/5 offline fixtures, no live Figma MCP verification.
- `npm run eval:recommendations`: **9/9 PASS**.

## Not done / limitations

1. OpenAI / Codex provider outputs have **not** been tested with real credentials. Demo uses deterministic options only.
2. Customer approval is a **reviewer/operator attestation** backed by a claimed source reference; independent customer identity or document signature verification is NOT implemented.
3. No guarantee that a proposed technical choice is semantically suitable. Quality requires actual BA validation on real cases.
4. There is no migration of runtime customer data in this source ZIP. Existing SQLite project records remain compatible; new fields are optional.
5. No live MCP execution or live BA acceptance has been performed.

## How to continue

- Unpack ZIP, use Node >=22.13, run `npm run setup`, `npm run doctor`, `npm run test:serial`, then `npm run setup:start`.
- For each project choose an actual tech stack, run Analyze/Gap Analysis, inspect draft alternatives, record a decision (BA/customer-attested + reference + rationale), then re-run Analysis and BA Review.
- At the beginning of an engineering agent session use `npm run session:bootstrap`; for customer work use `--project <uuid>`. Read `docs/SESSION_CONTINUITY_V3_5.md` and `docs/RECOMMENDATION_ASSISTED_CLARIFICATION_V3_7.md` before making changes.

## Next engineering task

Run **live acceptance** with two BA reviewers across 20–50 reviewed clarification questions spanning actual deployed tech stacks, evaluate recommendation usefulness, grounding, unsupported policy assertions and reviewer disagreement, and confirm runtime provider schema validity. Consider requiring signed customer evidence integration (via shared MCP server) before marking customer-authorized decisions verified.
