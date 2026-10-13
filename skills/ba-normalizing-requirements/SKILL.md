---
name: ba-normalizing-requirements
description: Use when stakeholder language contains overlapping requests, solution ideas, ambiguous behaviors, or mixed functional and non-functional requirements that need a traceable structured specification.
---

# Normalizing Requirements (BABOK 7.1, 7.4)

Convert elicited notes into precise, atomic statements while preserving meaning.

| Information | Canonical placement |
|---|---|
| Business outcome | `business.businessGoals[]` (`BG-###`) |
| Stakeholder need | `business.stakeholders[]` with role + need |
| Behavior / capability | `requirements.functional[]` (`FR-###`) |
| Quality constraint / measurable target | `requirements.nonFunctional[]` (`NFR-###`) |
| Rule or policy | `requirements.businessRules[]` (`BR-###`) |
| Open issue | `elicitation.questions[]` (`Q-###`) |

BABOK also distinguishes transition requirements. Current MVP does NOT have their own type: keep transition needs in a **question/assumption** instead of misclassifying as FR without review.

## Normalize each functional requirement

Describe actor, trigger, precondition, single observable system behavior, output, alternate/exception paths and testable acceptance criteria when the source supports them. Priority `Must/Should/Could` is provisional unless sourced. Link to goal and source; preserve exact sourceEvidence. Unknown fields stay empty or explicitly `TBD`.

**Anti-hallucination:** a designer's likely happy path, permission, tax rule, SLA, uniqueness policy, or numerical threshold MUST NOT become a confirmed requirement simply because it is industry-standard.

**Output:** `functional`, `nonFunctional`, `businessRules`, `businessGoals` plus provenance and traceability; forward to `ba-detecting-gaps`.
