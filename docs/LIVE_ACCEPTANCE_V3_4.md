# BA Studio v3.4 — Live Acceptance Validation (harness extension)

## What is implemented vs verified

Implemented and unit-tested: corpus admission checks, actual-provider evaluation runner, restart-safe progress log, human review packet, two independent reviewer decision sheets, human adjudication, traceable semantic recall and unsupported-requirement ratios, raw-model quotation grounding, reviewer-agreement measurement, read-only Figma REST vs MCP-operator cross-check, BA visual QA approval and a strict PASS/FAIL report. No new multi-agent orchestration.

**NOT YET EXECUTED against real services** in the development environment: it has no valid OpenAI API key, Codex CLI login, Figma access token or BA-approved gold corpus. A successful test on mocked fixtures is evidence of **harness logic only**, not a claim of model quality. Do not publish any approval without human and real-service evidence.

## Pre-requisites

- Node >=22.13; start with `npm test`, `npm run eval:live-tests`, and `npm run doctor`.
- Create a permissioned/anonymized corpus containing **20–50 distinct real cases** across representative business domains. See `eval/live-gold-template.json` (a **deliberately invalid synthetic example**, not release data).
- In each case, two identified BA reviewers must independently annotate expected FR/NFR concept alias sets; the adjudicated gold is marked `status=approved`, with `reference`, `adjudicatedBy`, `adjudicatedAt`. Set the root `provenance.kind=real-anonymized`, `dataUseApproved=true`, and a genuine `approvalReference` **only after** authorization and redaction. Root `figmaTarget` scopes an approved test file, FRAME ID/name and design spec reference.
- Approve disclosure of anonymized brief content to the chosen AI backend. Use a private local directory for corpus/review artifacts; files are written 0600, parents created 0700. Secure the original corpus itself and enforce retention.
- Configure **one** real provider in `.env` or inherited environment: `DEMO_MODE=false`, `AI_PROVIDER=openai`, `OPENAI_API_KEY=...` (or `AI_PROVIDER=codex`, authenticated `codex` CLI). Do not store tokens in code or reports.
- For Figma, configure Codex CLI MCP with read-only Figma tools + separately authorized `FIGMA_ACCESS_TOKEN` permitting `file_content:read`. Do not expose write scopes for acceptance probes.

## 1) Corpus validation and live extraction

```bash
npm run eval:live-acceptance -- --preflight --corpus /secure/ba-gold-reviewed.json
npm run eval:live-acceptance -- --run \
  --corpus /secure/ba-gold-reviewed.json \
  --out /secure/acceptance-runs/model-A-run.json \
  --confirm-external-processing
```

Preflight does **not** contact external services or verify auth. The `--run` flag makes at most **one provider invocation per case** (sequentially; 20–50 calls) and records each attempt immediately. It does not estimate spend; confirm quota/contract limits before use. Failures stop subsequent calls by default; to log failed cases while continuing, use `--continue-on-error`. If interrupted, `--resume` with the same `--out` and unchanged corpus/provider/model continues only **unattempted** cases. Because a remote provider might charge for a killed in-flight call, only a fresh new run can retry a failed case without inventing an exactly-once guarantee.

When complete, the runner creates (0600): `review-packet-<runId>.json` (contains the original briefs and gold), and three review templates (`reviewer-a-...`, `reviewer-b-...`, `adjudicator-...`). Copy them to separate files/locations, fill actual reviewer IDs/timestamps. Adjudicator identity must equal `annotation.adjudicatedBy` of every case.

Each prediction requires a human `verdict=supported|unsupported|needs-clarification` and `matchedGoldIds` (e.g. `FR-G1`, `NFR-G1`). For supported predictions, supply a customer-text `supportQuote` that appears verbatim in the relevant original brief; `unsupported` requires a reason in `note`, and cannot map to a gold concept. BA reviewers should judge semantics, not just exact aliases. The two independent review sheets and final adjudication sheet must be complete and bound to the same immutable predictions hash.

## 2) Figma MCP read-back cross-check (read-only)

```bash
# First actually use connected live Codex + Figma MCP read-only tools.
npm run eval:figma-contract -- --live \
  --file YOUR_TEST_FILE_KEY --node 1:2 --name 'Expected Frame Name' \
  > /secure/acceptance-runs/mcp-live-report.json

# Then cross-check that claimed MCP result against an independent Figma REST GET.
npm run eval:figma-crosscheck -- \
  --mcp-report /secure/acceptance-runs/mcp-live-report.json \
  --file YOUR_TEST_FILE_KEY --node 1:2 --name 'Expected Frame Name' \
  --out /secure/acceptance-runs/figma-proof.json \
  --confirm-read-only-figma
```

Only the exact file/node/name/`FRAME` match can be accepted. This is **cross-channel identity verification**, not Figma cryptographic attestation, actual design quality or an assertion that the wireframe implements all FR. The contract probe report is still agent-generated; its real provenance depends on controlled Codex CLI execution. Cross-check proof must be from the last 24h. Do not run against a customer production Figma file without explicit authorization.

A BA must also visually inspect the test frame against the approved design spec and record the separate scoped approval (`eval/live-visual-qa-template.json`, with `approved=true` only after review, a reviewer ID, timestamp and audit evidence reference).

## 3) Final semantic acceptance / release gate

```bash
npm run eval:live-acceptance -- --score \
  --corpus /secure/ba-gold-reviewed.json \
  --run-file /secure/acceptance-runs/model-A-run.json \
  --review-a /secure/reviewer-a-completed.json \
  --review-b /secure/reviewer-b-completed.json \
  --adjudication /secure/adjudication-completed.json \
  --figma-proof /secure/acceptance-runs/figma-proof.json \
  --visual-qa /secure/acceptance-runs/ba-visual-qa.json \
  --out /secure/acceptance-runs/acceptance-report.json
```

*Release thresholds (illustrative, change only with a reviewed acceptance policy):*

| Metric | Gate |
|---|---|
| Human-adjudicated FR recall | >=0.90 |
| Human-adjudicated NFR recall | >=0.85 |
| Unsupported predicted requirements (human) | <=0.03 |
| Original model `confirmed` source quote grounding | >=0.99 |
| Two BA reviewers exact judgment agreement | >=0.80 |
| Unresolved / missing human judgments | 0 |
| Figma REST vs MCP scope, frame name/type | Pass, <=24h old |
| BA visual QA approval | Approved against exact file/node/spec, <=30 days old |

Missing denominator, corpus, references or proof => FAIL or a validation error (nonzero exit). A report `PASS` is **local protocol acceptance only**, not certified legal/privacy compliance, stakeholder/customer signoff or end-to-end visual fidelity. The report includes no original brief or customer quote but review packet contains sensitive material. Archive corpus hash, model/prompt/app version, reviewer records and restricted source logs under your organization's retention policy.

## Threat model and trade-offs

- **Single-agent, low integration overhead**, sequential (bounded) live calls; slower than parallel but simpler to audit/rate-limit and safer on quota.
- **Manual BA adjudication** is more expensive but prevents a keyword-only metric being misreported as semantic quality; BA can still bias or collude, reviewer IDs are currently self-attested (no enterprise OIDC verification).
- Figma REST uses a separate authorized channel to catch mistaken MCP operator claims; it cannot establish that Codex truly invoked the MCP tool cryptographically, nor confirm UX quality. Separate BA visual QA is mandatory.
- **At-least-once API costs** possible on killed in-flight requests; persisted status avoids intentional silent replays. Metrics do not replace reconciliation with provider invoice or monitoring prompt-injection behavior in long workflows.
- Gold annotations can be stale, not representative or intentionally misrepresented; real BA signoff and broad-domain sampling remain necessary.
- For future portable integrations, implement an **MCP server** exposing `figma_read_only_verify` and `acceptance_artifact_register` with strict JSON schema; the REST readback is deliberately kept independent here, not blindly routed through the same LLM-operated MCP tool.
