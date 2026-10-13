---
name: ba-detecting-gaps
description: Use when requirements appear incomplete, vague, inconsistent, untestable, unsupported by sources, or disconnected from business goals and prototype screens.
---

# Detecting Requirement Gaps (BABOK 7.2)

Check **completeness, clarity, internal consistency, feasibility, verifiability and traceability**; report uncertainty instead of inventing a solution.

## Checks

- Business context: goal, current problem, stakeholder, scope boundaries and success measures.
- FR: actor, explicit behavior, testable acceptance, business goal link, source excerpt, main and exception paths.
- NFR: measurable target with measurement method, evidence, operating context (users / loads / devices when relevant).
- Policy: duplicate transactions, permissions, status transitions, approvals, failure paths and data retention **only when context makes these pertinent**.
- Cross-source: same requirement stated differently; mark contradiction with both source references. NEVER silently choose the convenient version.
- Trace: orphaned FR/NFR, prototype screen with no source requirement, and feature not linked to a goal.

## Output: a gap record

`{id, code, priority: High|Medium|Low, requirementId, impact, question, status:'open', origin}`.

Use High when unresolved information blocks safe design or objective testing; Medium for partial flows or goal linkage; Low for optional enhancements. One question should ideally settle one decision. Group duplicates and avoid a generic 30-question checklist.

**Runtime guard:** `src/ba-quality.js` performs conservative mechanical checks; an AI/BA must still detect *semantic* contradictions. A passing automated check is not proof of complete requirements.
