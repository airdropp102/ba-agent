---
name: ba-orchestrating-analysis
description: Use when a customer brief, stakeholder notes, or an evolving request must be turned into a controlled BA workflow with traceable requirements, clarification, BRD, SRS, and prototype outputs.
---

# Orchestrating Business Analysis

**Required process skill:** invoke `superpowers:brainstorming` to establish business intent and human review gates. This BA skill adds domain discipline; it does not override Superpowers' design/implementation approvals.

## Sequence

1. `ba-eliciting-requirements`: understand sources, objectives, stakeholders, context; preserve raw evidence.
2. `ba-normalizing-requirements`: atomic FR/NFR, actors, business rules, goals, priorities, evidence.
3. `ba-detecting-gaps`: check completeness, contradictions, traceability, testability and unknowns.
4. `ba-clarifying-requirements`: ask prioritized questions; incorporate attributed answers; repeat steps 2–4.
5. `ba-verifying-requirements`: **verify** quality and **validate** business value with stakeholders separately.
6. `ba-generating-deliverables`: derive BRD, SRS and click-through prototype from ONE `ba.canonical.v1` model.
7. `ba-designing-figma`: after BA review, optionally derive a ui-ux-pro-max-driven editable Figma design from BRD/SRS via cursor-talk-to-figma-mcp. Require operator-managed channel and verified node IDs; Figma drawing is not customer approval.

## Stop / handoff

- When customer facts are missing, produce a **questionnaire and draft**, not invented business rules, thresholds or screens.
- `evidence-found` means text was found in the source, **never** customer-approved.
- BA review records preparation, not a customer sign-off or baseline.
- Preserve FR/NFR/BR/Q IDs across elicitation and clarification revisions. Never renumber existing records when adding, removing or reordering items; keep unanswered Q IDs open. Record additions, amendments and retirements with their provenance.
- Never launch coding/implementation from unapproved BRD/SRS.

## Interface

Canonical contract: `schemas/ba-canonical-v1.schema.json` in this project. Preserve identity across revisions using `src/revisions.js`; ambiguous matching must be reviewed, not silently treated as the same requirement. Cite actual source IDs from the source catalog, never blanket `SRC-001`. Analyst notes remain unverified; customer-text evidence requires customer attribution and a source reference and still does not prove sign-off. Quality report contains `findings`, `counts`, `status`.

IIBA BABOK v3 task mapping: `docs/babok-mapping.md`. Do not represent this original workflow as an IIBA-certified product or copy proprietary BABOK text.

## Current executable workflow

Read `docs/ARCHITECTURE.md` and `docs/WORKFLOWS.md`; `src/intelligent-workflow.js` owns stage IDs. For a BA Studio project, prefer `POST /api/projects/:id/workflow/advance` over stitching manual calls. The UI uses `/workflow/jobs` with a durable worker. Node executes policy through prompts and deterministic guards; it does not invoke Superpowers skills as server processes.

The non-ERP sequence is BRAINSTORM → ELICITATION → GAP_ANALYSIS → CLARIFICATION → BA_REVIEW → DELIVERABLES, then COMPLETED. Only BRAINSTORM produces speculative hypotheses. ELICITATION owns source-grounded extraction and normalization; GAP_ANALYSIS refreshes pending analysis and reports gaps/recommendations, not an independent semantic approval.

- Respect WAITING_CLARIFICATION: only an explicit waiver covering all current High blockers with rationale and matching digests permits proceeding despite those blockers.
- Respect WAITING_BA_REVIEW and `requirementsRefreshPending`; answers require re-analysis and a new human review before downstream outputs.
- For ERP, insert ERP_SOLUTION_DESIGN between BA_REVIEW and DELIVERABLES. Respect WAITING_ERP_TARGET and WAITING_ERP_DESIGN_REVIEW; confirmed target and current approved design are separate from customer sign-off.
- `BA_QUALITY_ENFORCE=true` gates orchestrated DELIVERABLES with WAITING_QUALITY_REVIEW. Deterministic scores do not certify semantic quality; preserve manual API compatibility.
- Let the runtime commit stage checkpoints and manage queue leases/retries. A successful job may have stopped at a human gate. Inspect persisted state before resuming; external side effects are not exactly-once.

Figma is a separate operator-approved action in Prototype after current BA Review and traced prototype screens. Use `ba-designing-figma` and `docs/figma-handoff.md`; require file/channel confirmation, read-back and human visual review. Historical FIGMA_DESIGN/FIGMA_PUBLISH checkpoints remain readable for compatibility; do not replay them as current workflow stages. A registry/operator report is not independent attestation. Do not generate application source code.

## ERP domain overlay (v3.8)

When a project declares `solutionProfile.domain=erp`, also use `ba-analyzing-erp` before selecting an ERP platform. Keep actual tech stack distinct from candidate platform shortlist. Perform human-evidenced Fit–Gap by requirement and target platform/version/edition; do not assume product features or local regulatory coverage. Retain manual gates, version/audit, and project-specific handoff.
