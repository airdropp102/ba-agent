# BA Skills on Superpowers — design, 2026-10-13

## Intent
Build a local-first BA workflow using Superpowers agent process skills and BABOK v3-inspired elicitation, normalization, gap detection and verification. Emit BRD, SRS, questionnaire and safe clickable wireframes from one versioned requirements model. The customer may provide a short ambiguous brief; unsupported details must stay questions/assumptions.

## Tradeoff and approach
Selected: **reusable Agent Skills + deterministic Node quality guards + structured AI extraction**. Alternatives: single large agent prompt (easy but hard to audit), independent microservices per agent (overkill for MVP). The Node application does **not** execute the Superpowers plugin directly: skills are interpreted by an AI-capable agent runtime when installed and their domain rules are embedded in the live extraction prompt; Node enforces core invariants.

## Modules
- Source intake and AI extraction: existing `src/openai.js`, `src/normalize.js`.
- BABOK domain instructions: `skills/ba-*/SKILL.md` and `AGENTS.md`.
- Gap/question policy: `src/ba-quality.js`; rule findings never create FRs.
- Versioned handoff contract: `src/ba-canonical.js`, `schemas/ba-canonical-v1.schema.json`.
- Renderers: `src/docs.js`, `src/export.js` (HTML is data-driven, not AI executable code).
- Workflow: analyze → quality → customer questions → revise → BA review → draft BRD/SRS/prototype. BA review explicitly not a customer sign-off.

## Errors and guardrails
Input size bounds; strict JSON Schema for AI; invalid evidence downgraded to assumptions; follow-up invalidates BA review/prototype; semantic contradictions require human judgement; quality gate marks blockers but does not fake baseline; project data is local. The current MVP does not have PDF/DOCX intake, audit-grade provenance or fine-grained customer sign-off.

## Verification
Node tests cover grounded evidence, missing actor/acceptance, orphan screen IDs, canonical traceability, API, export and revision. Live model behavior needs separate online evaluation and real BA/customer confirmation.
