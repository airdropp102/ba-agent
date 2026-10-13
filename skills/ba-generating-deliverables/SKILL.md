---
name: ba-generating-deliverables
description: Use when a reviewed requirements model must be rendered consistently into a BRD, SRS, clarification questionnaire, clickable prototype, or traceability matrix.
---

# Generating Consistent Deliverables (BABOK 7.1, 7.4, 7.5)

**Input:** exactly one versioned `ba.canonical.v1` JSON object; create it using `src/ba-canonical.js` or a compatible agent with the published schema. If required fields or source evidence are absent, mark draft instead of filling from convention.

| Output | Contents |
|---|---|
| BRD | Problem, goals, stakeholders, in/out scope, business rules, high-level capabilities, assumptions, risks, unresolved questions |
| SRS | Actor, triggers, FR/NFR, flows, preconditions, testable AC, data/integrations when provided, trace matrix |
| Prototype | Navigation and screens, only for explicit FR IDs; show assumptions as provisional |
| Questionnaire | Q IDs, priority, impact, blank customer answer and evidence slots |

## Invariants

- Keep FR/NFR/goal IDs intact across all artifacts. Never silently renumber mid-revision.
- Every interactive screen lists originating FR IDs; no phantom features, payments or roles.
- A new elicitation answer invalidates downstream review and prototype for the prior version.
- Label outputs **DRAFT** while open questions/assumptions remain; never imply production UI or completed business acceptance.
- Do not emit executable code from the LLM; the local UI renderer safely renders structured screen data.

**Stop:** without requirements, produce an issue list and question template; do not manufacture a complete-looking SRS.
