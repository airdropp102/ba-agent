---
name: ba-clarifying-requirements
description: Use when stakeholder inputs leave open decisions, conflicting policies, missing metrics, or ambiguity that prevents a BA from confirming business and software requirements.
---

# Clarifying Requirements (BABOK 4.2, 4.3, 4.4)

For each material gap, ask one neutral, concrete question with affected FR/NFR and consequence of silence. Prioritize unanswered High-impact decisions first. Do not suggest one answer as the only acceptable choice. Use selectable options only when grounded in the domain, always permit a free-form answer.

## Question and answer protocol

1. Present `Q-###`, affected requirement ID, priority, business impact, respondent/role and decision deadline if known.
2. Preserve verbatim customer response and its provenance (`email`, `workshop`, `document`, timestamp and approver when available).
3. Apply the answer only to affected requirements. Preserve FR/NFR/BR/Q IDs across revisions; never renumber unaffected records or unanswered questions. Mark original vs amended behavior and re-run normalization and verification.
4. Keep unanswered questions open; a BA-generated suggestion cannot be a verified customer response.
5. Regenerate drafts and trace links; invalidate older BA review and prototype on revision.

**If answers are missing:** return a questionnaire, list specific blockers and stop short of asserting baseline readiness. Never forge customer sign-off.

**Output:** answered/unanswered questions, amendment log, affected IDs, revision and outstanding gaps.

## Recommendation-assisted clarification

- For each still-open question, optionally propose **1–3 distinct DRAFT alternatives** appropriate to the operator-declared project tech stack. Include affected scope, implementation approach, likely benefits, trade-offs, dependencies, and a reasoned preference only when evidence permits.
- Technical mode requires declared stack/candidate references; never invent the stack, business policy, SLA or scope. Business mode may propose DRAFT answers without a stack and must not invent technology. Read `docs/CLARIFICATION.md` for mode-specific contracts.
- `selectionMode:ba-draft` may rank and preselect a DRAFT option; it never commits a decision. A human must explicitly save the exact option with approval authority (`ba` or `customer`). Manual approvals require source/reference and rationale; the BA UI may use its internal decision-log reference under `decisionContext:ba-ui`, which is not customer evidence. Customer authority requires respondent/evidence under the applicable API contract and never proves baseline sign-off independently.
- A BA-accepted technical solution is an **authorized BA decision / answered clarification**, **not automatically customer-confirmed requirements**. Customer-selected choices are recorded separately and do not imply approval of the PRD/SRS baseline.
- Re-analyze after decisions; reject stale recommendations when questions or stack change. Invalidate BA Review, prototype, generated design and dependent checkpoints before resuming. Preserve the immutable decision log and per-project audit history.
- Format the export with selected answer, proposer/approver role, evidence reference, and unresolved trade-offs. Proposals without explicit approval remain open.
