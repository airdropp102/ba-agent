> **Quality and telemetry:** Read `docs/ARCHITECTURE.md` before changing quality gates or telemetry. Do not promote a deterministic quality score to semantic/customer approval. Treat missing provider usage/pricing as UNKNOWN, not zero; never store prompts or customer text in `ai_invocations`. `BA_QUALITY_ENFORCE=true` only gates the orchestrated DELIVERABLES stage; keep existing manual APIs backward compatible. Run `npm test`, `npm run eval:quality`, and `npm run eval:figma-contract`. Live MCP operator reports are not independent attestation.

> **Runtime**: Node.js >=22.13 (`node:sqlite`), SQLite WAL authoritative data in `DATA_DIR`; JSON is a compatibility mirror. Durable queue worker (`npm run worker` or embedded in HTTP process), fencing leases, reviewer audit and Figma read-back. Read `docs/ARCHITECTURE.md` before changing state transitions. Do not substitute operator MCP reports for Figma independent attestation/customer signoff. Preserve v3.2 endpoint behavior and run `npm test` + `npm run eval:production`.

# BA Studio agent instructions

When processing customer requirements, use `ba-orchestrating-analysis` plus the relevant BA skills in `skills/ba-*/SKILL.md`; for designing implementation use installed `superpowers:brainstorming`, `superpowers:writing-plans`, and normal Superpowers verification workflow. Do not imitate a Superpowers tool call inside the Node server; these files are discoverable skills for agent runtimes, while Node executes the matching policy via prompts + deterministic guards.

Contract: `schemas/ba-canonical-v1.schema.json` / `src/ba-canonical.js`.

Never turn industry defaults, speculative flows, guessed NFR thresholds, or an unsupported prototype screen into customer-approved facts. Quotes prove textual support only. Keep open Q IDs; label BRD/SRS/prototype DRAFT. Do not claim BA review is client approval. See `docs/babok-mapping.md`.

For editable Figma handoff, use `ba-designing-figma` only after BA Review. Follow `docs/figma-handoff.md`, use installed UI UX Pro Max and TalkToFigma MCP, and never claim Figma artboards or native prototype navigation were created without verified MCP results.

## change/provenance discipline
Preserve FR/NFR/BR/Q IDs across elicitation iterations; do not renumber when adding/removing records. Cite actual source IDs rather than guessed blanket SRC-001. Analyst notes are unverified even when a text quote matches. Only customer-attributed answers with respondent + source reference may supply customer-text evidence, and customer-text evidence still does NOT prove sign-off. Previous snapshots are read-only local history. For live Figma work, use a file-key-specific registry, never claim verification solely from a prompt, and have the human inspect frames and any navigation.

## runtime checks / hardening
Before use run `npm run doctor` and `npm test`; use `npm run eval` for the **offline** guardrail suite. `npm run setup:start` boots the local web service in foreground. Do not treat offline evaluations as semantic accuracy benchmarks. Do not bypass the provider-neutral validation in `src/model-output.js`; persist neither invalid model output nor unverifiable Figma node IDs. When exposing the API or sharing clients, set `REQUIRE_IF_MATCH=true` so all project POST requests require a version. Multiple same-host processes may share local SQLite `DATA_DIR` via v3.3 leases; never use SQLite WAL on NFS/SMB. For all architecture trade-offs and supported vs. planned runtime capabilities read `docs/ARCHITECTURE.md`.

## Intelligent BA Workflow
The main run contract is `docs/ARCHITECTURE.md`. Prefer `POST /api/projects/:id/workflow/advance` (auto to quality gate) over stitching isolated calls in a separate agent. `src/intelligent-workflow.js` owns stage IDs, checkpoint integrity, clarification blockers and waiver signatures. Only `BRAINSTORM` produces speculative ideas. The existing source-grounded `ELICITATION` owns validated FRs; do not merge hypotheses into confirmed requirements. Never bypass `WAITING_CLARIFICATION`, `WAITING_BA_REVIEW`, or call Figma MCP without operator approval. Existing manual routes must remain compatible. Use `npm run eval:workflow` and `npm run eval:semantic` as additional diagnostics; synthetic keyword metrics do **not** certify semantic understanding.

## Live acceptance validation

For live acceptance commands and safety boundaries, read `docs/LIVE_ACCEPTANCE.md` first. Never silently call external models with customer briefs or state that fixture metrics prove real-world accuracy. The live benchmark requires approved anonymized 20–50 case corpus, explicit transmission permission, two BA reviews, adjudication, scoped Figma read-back cross-check, and human visual QA. The synthetic example must always fail production preflight. Never bypass acceptance release gates by inserting dummy evidence.

## Codex / Claude session continuity — required workflow

Read `docs/SESSION_CONTINUITY.md` and run `npm run session:bootstrap` **before modifications**. This is a separate engineering-session/task ledger, not a replacement for BA project workflow checkpoints. Choose `RESUME` or `NEW_TASK` explicitly; do not assume the most recent chat is authoritative. For `RESUME`, call the CLI with explicit `taskId`, `expectedVersion` and `runtime`; after takeover, only the new session may commit. On `RECONCILE` verify repository state/artifact SHA against committed checkpoint and obtain an explicit invalidation rationale; never fake a match. After each milestone, use `npm run session:checkpoint -- --file ...` with `completed` evidence artifacts, outstanding `next`, `decisions`, `risks` and reported test results. Preserve `completed` from earlier checkpoints or document invalidations. Use `session:handoff` before compaction/end, plus optional `.codex/hooks.json` / `.claude/settings.json`; hooks only export committed state, never extract hidden context. Keep `.session-handoff/`, `data/`, secrets and customer texts out of Git. Do not claim it is safe to finish while unfinished steps, risks or evidence drift remain. Run `npm run eval:continuity` and `npm run test:serial` for changes to the engine.

## Multi-project workspaces (mandatory)

Read `docs/PROJECT_WORKSPACES.md`. When work concerns a BA customer project, identify its immutable UUID from `/api/projects`, and run `npm run session:bootstrap -- --project <uuid>` before modifying project artifacts. Never use another project's `08-sessions` handoff or completed steps. Store all customer materials, PRD/BRD/SRS, prototype, design pack and BA review in `DATA_DIR/projects/<uuid>/`; `DATA_DIR/ba-studio.sqlite` remains the authoritative index and transaction engine. For platform-level engineering tasks without a BA project use the global continuity namespace. Do not edit customer files in another project's workspace or assume project title is a safe filesystem path. Use `npm run project:migrate` to repair exported workspace snapshots, never manually replay completed workflow steps. Run `npm run eval:workspaces` and `npm run test:serial`.

## Recommendation-Assisted Clarification

Read `docs/CLARIFICATION.md`. Never auto-select a recommendation, fabricate tech stack, convert BA-accepted implementation choices to customer-signed requirements, or bypass `requirementsRefreshPending`. Record exact approved option, authority and evidence; re-analyze and re-review before creating downstream deliverables. If the project tech stack/question changes, invalidate options and review; keep historical decisions. Run `npm run eval:recommendations` plus `npm run test:serial`.


## ERP business analysis / solution candidates

Read `docs/ERP.md`. If `solutionProfile.domain=erp`, use the `ba-analyzing-erp` skill: capture As-Is/To-Be, cross-module process ownership, master data, finance/localization, migration, integrations, SoD and UAT. Keep *installed* `techStack` separate from *candidate* ERP platforms. Odoo Community / ERPNext are open source under their respective licenses; Odoo Enterprise is commercial. Never claim module/feature/license/local statutory compliance without version/edition-specific evidence. `ERP_FIT_GAP.json` contains human-attested reviews only; `UNASSESSED` means unverified, not unavailable. Do not auto-approve or invent 3–5-year TCO. On change to ERP shortlist or Fit–Gap evidence, regenerate stale proposals and re-review deliverables. Keep all artifacts scoped to project UUID, and preserve `session:bootstrap` / `session:handoff` discipline. Run `npm run eval:erp` and `npm run test:serial`.
