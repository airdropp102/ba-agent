# BA Studio v3.4 — Live Acceptance Validation Implementation Report

**Date:** 2026-10-13  
**Base:** BA Studio v3.4 Production Validation & Quality Intelligence  
**Scope:** Live acceptance harness, not a claim of successful live business acceptance.

## Executive result

| Dimension | Outcome |
|---|---|
| Implementation | **COMPLETED** — provider runner, human reviews/adjudication, Figma cross-check, release gate |
| Full regression (serial) | **76/76 PASS** |
| New live harness tests | **15/15 PASS** (13 core contract/gates + 2 CLI fail-closed) |
| Legacy guardrail evaluator | **PASS**, 6/6 |
| Offline Figma contract fixtures | **PASS**, 5/5 (1 positive, 4 negative) |
| Doctor | **PASS**, minor warning: USD price catalog missing |
| Offline synthetic BA proxy benchmark | FR recall 0.50, FR precision 1.00; not live model quality |
| Real OpenAI/Codex inference | **NOT EXECUTED** — no API key or Codex CLI session |
| Real Figma MCP + REST crosscheck | **NOT EXECUTED** — no Figma token/session |
| 20–50 human-approved domain gold cases | **NOT PROVIDED** |
| Final go-live quality acceptance | **NOT EXECUTED / NOT APPROVED** |

An earlier parallel `npm test` run had one intermittent v3-api server-start readiness timeout (73/74 tests passed), while the individual test and full deterministic `npm run test:serial` run passed. Treat default highly parallel test execution as potentially flaky in resource-constrained CI; use `test:serial` until the legacy 4.5s server readiness test is refactored.

## New code

- `src/live-acceptance.js`: corpus validation (20–50 real anonymized approved cases, two named BA annotators, scoped Figma spec), stable prediction IDs, immutable run/predictions digest, BA judgment validation, human-adjudicated FR/NFR recall, hallucination proxy via unsupported verdicts, two-reviewer agreement, raw confirmed quotation-grounding ratio, STRICT composite PASS/FAIL gate.
- `scripts/live-acceptance.mjs`: `--preflight`, `--run`, `--resume`, `--score`, explicit `--confirm-external-processing`; one sequential provider call per case; case-level crash-aware progress journal; review packet and individual reviewer/adjudication templates.
- `scripts/figma-crosscheck.mjs`: independent read-only `GET /v1/files/{key}/nodes?ids=...` to Figma with an operator-provided prior LIVE MCP report; refuses scope/type/name mismatch and uses a dedicated token. API described by [Figma File Endpoints](https://developers.figma.com/docs/rest-api/file-endpoints/).
- `tests/v34-live-acceptance.test.js`, `tests/v34-live-cli.test.js`: positive fixture protocols and negative tests for forged/missing labels, low recall, unsupported requirements, disagreement, tampering, raw evidence, missing/stale/wrong Figma proof, missing scoped visual QA and synthetic corpus admission.
- `eval/live-gold-template.json`: **intentionally synthetic and invalid** production example (never use as actual gold). `eval/live-visual-qa-template.json`: blank approval form.
- `docs/LIVE_ACCEPTANCE_V3_4.md`, AGENTS.md, README.md, `.env.example`, `.gitignore`, NPM scripts.

## Intended real acceptance protocol

```text
Approved/anonymized briefs (20–50) + two BA gold annotators
       ↓ corpus validation, authorization
Codex or OpenAI actual elicitation (max one attempt/case; persisted)
       ↓ predictions, raw grounding stats
BA reviewer A ─── BA reviewer B
       └──── human adjudication ──┐
                                  ├── measurable quality gates
Figma MCP read-only operator probe┐│
Figma REST independent scoped GET ┤│
BA visual QA / spec signoff ──────┘│
                                  ↓
                      Local PASS / FAIL report
```

Defaults for final release: FR recall ≥90%; NFR recall ≥85%; BA-adjudicated unsupported requirement rate ≤3%; raw confirmed quotation grounding ≥99%; exact reviewer judgment agreement ≥80%; zero unresolved judgments; valid live scoped MCP + REST proof ≤24 hours old; separate scope-matched BA visual QA ≤30 days old; and zero unattempted/failed cases. These policy thresholds are proposals pending team acceptance, **not measurements of BA Studio on real data**.

**Operator must still:** anonymize and label representative cases with two reviewers and a recorded adjudicator; approve input transfer; configure logged-in Codex/OpenAI; connect read-only Figma MCP and a REST read token with file-content-read access; run probes on an approved test file; complete BA visual QA; issue a release decision after reviewing all failures and metrics. See `docs/LIVE_ACCEPTANCE_V3_4.md` for complete executable commands.

## Verification run

```bash
cd ba-agent-mvp
npm run test:serial               # 76/76 PASS
npm run eval:live-tests           # 15/15 PASS
npm run eval                     # 6 guardrails PASS
npm run eval:figma-contract      # 5 offline fixtures PASS, NOT LIVE
npm run eval:quality             # 5 synthetic cases; FR proxy 0.50
npm run doctor                   # PASS, with cost pricing warning
npm run eval:live-acceptance -- --preflight --corpus eval/live-gold-template.json
# EXPECTED exit 2: synthetic corpus is NOT accepted for go-live
```

## Trade-offs and residual risks

1. **Single-agent + sequential provider calls**: bounded 20–50 external calls and easier audit/privacy/cost limits, but no parallel throughput optimization; a killed in-flight call may still be charged. Resume skips attempted cases and does not claim exactly-once billing.
2. **Independent BA reviews**: stronger semantic evidence than simple keyword alias matching, but reviewer identity/approval references are self-asserted in file artifacts (no OIDC/RBAC); team should store approvals in a trusted audit system.
3. **Figma MCP plus separate REST**: can cross-check file, node type/name via independent GET and blocks scope substitution. A malicious operator might falsify the MCP text report, and a matching FRAME is not proof of end-to-end UX quality. BA visual QA is an explicit separate gate; no changes are written to Figma.
4. **Raw model confirmed quote checks**: pre-normalization claims are inspected so post-processing cannot hide bad source claims; still does not establish business semantic correctness.
5. **Data/privacy**: review packets include briefs and AI-generated text. Keep outside VCS on encrypted volumes, restrict access and retention. The runner does not send briefs without `--confirm-external-processing`.
6. **No present production approval**: in this environment there are no connected real credentials, authenticated human approvals or permissioned real corpus. Final acceptance remains unexecuted.

**Next operator action:** Prepare and supply an anonymized, BA-reviewed corpus of 20–50 representative cases plus a test Figma file/FRAME scope. Configure credentials **locally only**, not in conversation or committed source; then run the documented commands and attach the generated report for review.
