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
- A question has a stable ID *within one revision*. Clarification creates a new revision; report changed IDs.
- Never launch coding/implementation from unapproved BRD/SRS.

## Interface

Canonical contract: `schemas/ba-canonical-v1.schema.json` in this project. Every FR/NFR uses a stable `FR-###` / `NFR-###` ID per revision and traceability. Source reference `SRC-###`; all unsupported ideas marked assumptions. Quality report contains `findings`, `counts`, `status`.

IIBA BABOK v3 task mapping: `docs/babok-mapping.md`. Do not represent this original workflow as an IIBA-certified product or copy proprietary BABOK text.

## v3.2 executable workflow
When a BA Studio project is present, use the implemented single-agent workflow state machine (`src/intelligent-workflow.js` + HTTP `/workflow/advance`). The order is BRAINSTORM → ELICITATION → GAP_ANALYSIS → CLARIFICATION → BA_REVIEW → DELIVERABLES → FIGMA_DESIGN → FIGMA_PUBLISH. Hypotheses are DRAFT; do not promote them into confirmed source-backed requirements. Pause when high blockers remain; only an explicit, all-blocker BA risk acceptance with rationale permits moving to BA Review. BA Review requires human approval. Save stage checkpoint before proceeding to the next stage and retry an interrupted stage via explicit `/workflow/advance`, never a phantom background job. Build a Figma handoff and require explicit Codex + TalkToFigma MCP publish; a verified registry is a report, not proof of visual fidelity. Do not generate application source code.

## ERP domain overlay (v3.8)

When a project declares `solutionProfile.domain=erp`, also use `ba-analyzing-erp` before selecting an ERP platform. Keep actual tech stack distinct from candidate platform shortlist. Perform human-evidenced Fit–Gap by requirement and target platform/version/edition; do not assume product features or local regulatory coverage. Retain manual gates, version/audit, and project-specific handoff.
