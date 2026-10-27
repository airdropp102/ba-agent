# BA document templates

These original Vietnamese Markdown templates are applied to generated documents; they are not unused examples or reproductions of a proprietary standard. They tailor the requested reference structures to BA Studio's existing data model. Field coverage and references do not certify full standards conformance, semantic accuracy or customer acceptance.

| Document | Reference basis | Main content | Template / export kind |
| --- | --- | --- | --- |
| BRD | BABOK v3; business requirements specification (BRS) in ISO/IEC/IEEE 29148:2018 | Business context and needs, goals, success measures to confirm, stakeholders, scope, operations/transition gaps, rules, risk and change/approval control | `templates/documents/BRD.md` / `brd` |
| SRS | ISO/IEC/IEEE 29148:2018 | Purpose and software boundary, terminology, external interfaces, FR/NFR, data, constraints, verification and traceability | `templates/documents/SRS.md` / `srs` |
| URD | Stakeholder Requirements Specification (StRS), ISO/IEC/IEEE 29148:2018 | Stakeholder needs, operational context, user-goal drafts, quality expectations and stakeholder acceptance questions | `templates/documents/URD.md` / `urd` |
| Use case | Alistair Cockburn, *Writing Effective Use Cases*; UML | Scope/goal level, actors/interests, trigger, preconditions, guarantees, main scenario, extensions, variations, acceptance and UML associations | `templates/documents/USE_CASES.md` / `use-cases` |
| User story | Mike Cohn; Bill Wake's INVEST; Cucumber Gherkin | Role/goal/value, conversation, unassessed INVEST checklist, draft Given/When/Then scenarios, exceptions and traceability | `templates/documents/USER_STORIES.md` / `user-stories` |

BRD and URD are the product's document names; BRS and StRS name the corresponding ISO information items. BABOK is a body of knowledge, not one mandatory BRD form. This implementation references the requested 2018 edition rather than a legacy IEEE 830 template. It does not assert a clause-by-clause licensed-standard audit. Organization-specific tailoring, responsibility, approval and the complete required information-item contents must still be reviewed by the document owner.

## Generation and provenance

`src/standard-documents.js` consumes one `ba.canonical.v1` snapshot. Project renderers in `src/docs.js` build that snapshot and keep the existing quality, clarification and ERP appendices. No LLM call, schema change or new approval workflow is introduced by formatting/exporting these documents. Existing provider prompts and skills remain unchanged, including the prototype policy, so this feature does not silently change benchmark prompt manifests.

The five template files contain `{{field_name}}` slots. The renderer fills only known slots in one pass; slot contents are data, never executable expressions. Blank-template downloads retain the slots for manual editing. Static language in sections describes unknown information and review work, not customer requirements.

- FR/NFR/BR/Q IDs and actual source references remain those of the canonical model. Unresolved questions retain their IDs and status.
- `UC-FR-001` and `US-FR-001` are deterministic document-view aliases for `FR-001`; reordering FRs does not renumber these aliases. No new approved canonical requirements are created.
- Business goals and stakeholder needs come from the analysis model and remain DRAFT. URD's FR-based user-needs view is explicitly derived, not silently promoted to validated stakeholder statements.
- Quote evidence is shown with its source only when that source exists in the canonical catalog. Unsupported evidence remains unverified. BA notes and BA choices are not customer sign-off.
- Unknown KPI, budgets, technical limits, triggers, guarantees, interface contracts, data dictionaries, ownership, dependencies and acceptance results remain unconfirmed. The renderer does not infer them from industry defaults, a prototype, or the presence of an FR title.
- Existing flow/AC text remains proposed. Gherkin is an editable draft with no step definitions or execution result. Missing scenario components are explicit and tagged `@incomplete`.
- INVEST is a human checklist; every criterion starts unassessed. No story points or semantic pass marks are generated automatically.
- UML source includes only actor associations present in FR data. Diagram labels use safe generated aliases; customer text stays in a lookup table. No include/extend relationship is guessed. PlantUML is not executed or sent to a rendering service.

## Access, workspaces and history

`GET /api/document-templates/:kind.md` downloads the blank template without a BA project or BA Review; it contains no customer data and uses the service's normal access protection. Supported kinds are the five in the table. Existing PRD output remains available; no PRD blank template is added.

`GET /api/projects/:uuid/export/:kind.md` downloads the populated document only after current BA Review and with no `requirementsRefreshPending`. Existing project exports and manual API behavior remain compatible. The UI provides URD, Use case and User story tabs, plus separate populated/blank download actions. Exporting is not a customer approval event.

Current draft projections are stored under `DATA_DIR/projects/<uuid>/02-requirements/{BRD,SRS,URD,USE_CASES,USER_STORIES}.md`. Like existing BRD/SRS projections, their existence before BA Review is not export permission. Future `09-archive/vNNNNNN/` snapshots include the new outputs. Existing archive files are never overwritten; old snapshots are not rewritten into the new template. When analysis disappears, current document projections are removed while historical snapshots remain.

## Primary references checked

- [ISO/IEC/IEEE 29148:2018 product page](https://www.iso.org/standard/72089.html) and [public ISO OBP preview](https://www.iso.org/obp/ui?_escaped_fragment_=iso:std:iso-iec-ieee:29148:ed-2:v1:en).
- [IIBA: understanding requirements and designs](https://www.iiba.org/knowledgehub/the-business-analysis-standard/4-implementing-business-analysis/4-4-understanding-requirements-and-designs/), including BABOK's requirement classifications.
- Alistair Cockburn, *Writing Effective Use Cases* (2001); [Jacobson and Cockburn's public Use-Case Foundation](https://alistaircockburn.com/Use%20Case%20Foundation.pdf).
- [OMG UML 2.5.1 specification](https://www.omg.org/spec/UML/2.5.1/).
- [Mike Cohn / Mountain Goat Software: Writing User Stories](https://www.mountaingoatsoftware.com/agile/user-stories/writing-user-stories).
- [Bill Wake: INVEST in Good Stories, and SMART Tasks](https://xp123.com/invest-in-good-stories-and-smart-tasks/).
- [Cucumber: Gherkin reference](https://cucumber.io/docs/gherkin/reference/).
