# Standards-aligned document templates and additional outputs

**Goal:** Apply reusable BRD/SRS templates and add URD, use-case and user-story outputs to BA Studio, as requested.

**Scope and basis:** Vietnamese Markdown templates and filled exports. SRS references ISO/IEC/IEEE 29148:2018; BRD maps to BRS and BABOK v3; URD maps to StRS; use cases follow Cockburn's fully dressed structure with UML actor/goal associations; user stories use Mike Cohn's role/goal/value form, Bill Wake's INVEST and Cucumber Gherkin. These are original tailored templates, not copied proprietary standards or certification of conformance. Missing facts stay explicitly unconfirmed. Public primary references and coverage/tailoring limitations are documented.

**Architecture:** Five editable `templates/documents/*.md` files consumed by one template renderer, not unused example documents. `src/standard-documents.js` consumes `ba.canonical.v1` only; existing `src/docs.js` entry points adapt projects via `buildCanonicalPackage` and retain existing clarification, ERP and quality appendices. No provider/prompt/schema/state-transition change. Persist current files and future immutable snapshots in each project's `02-requirements`/`09-archive`; existing archived files remain untouched. New exports use the same BA Review and requirements-refresh gates. Blank templates contain no project data and can be downloaded independently.

**Invariants:** Preserve all canonical FR/NFR/BR/Q/source IDs. Use `UC-<FR id>` and `US-<FR id>` only as deterministic document view aliases, not new approved requirements. Never infer triggers, guarantees, budgets, acceptance thresholds, estimates, sign-off or include/extend relations. Proposed flow/AC/Gherkin content remains DRAFT and unverified. INVEST statuses remain unassessed pending human review. Quote matches prove textual support, not stakeholder approval. Review notes are unverified; never treat them as customer sources.

## Inline tasks

### 1. Templates and canonical rendering

Files: five `templates/documents/*.md`, `src/standard-documents.js`, `src/docs.js`, `tests/standard-documents.test.js`.

- [x] Write failing tests for template identity, required sections, all five rendered outputs, actual source IDs and retained requirement IDs; missing facts must stay unknown; no unresolved template tokens.
- [x] Test use-case/story aliases remain stable under FR reorder; empty analysis emits missing-information guidance; no mutation or customer approval; Gherkin is draft and INVEST is not auto-passed.
- [x] Author template sections, one canonical renderer and adapters for BRD/SRS/new outputs. Preserve existing PRD, questionnaire, quality and ERP behavior.
- [x] Run targeted renderer and existing document/evidence tests.

### 2. Workspace and API integration

Files: `src/server.js`, `src/project-workspaces.js`, `tests/standard-documents-http.test.js`, `tests/v36-project-workspaces.test.js`.

- [x] Add failing HTTP/workspace tests for new exports, project isolation, BA review/refresh guards, blank templates, archive preservation and cleanup of current outputs when analysis is invalidated.
- [x] Add `/api/document-templates/:kind.md`; add `urd.md`, `use-cases.md`, `user-stories.md` exports using existing gates and download handling.
- [x] Generate new workspace projections and new archive files without overwriting existing historical documents.

### 3. UI and verification

Files: `public/app.js`, `public/index.html`, `docs/DOCUMENT_TEMPLATES.md`, `docs/PROJECT_WORKSPACES.md`, `docs/ARCHITECTURE.md`.

- [x] Add document navigation, labels, filled-download and blank-template actions; retain PRD and Figma actions.
- [x] Verify all five document tabs/downloads in Chrome on synthetic reviewed data and confirm pre-review guards; check mobile navigation/overflow without external model or Figma calls.
- [x] Document original-template coverage, source links, unknown-field policy and approval limits.
- [x] Run doctor, npm test, test:serial, eval, eval:quality, eval:figma-contract, eval:production and eval:workspaces. Record milestones and final session handoff.
