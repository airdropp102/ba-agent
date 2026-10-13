# BA Studio v3.8 — Release Handoff

Last milestone: 2026-10-13. Source base: v3.7 Recommendation-Assisted Clarification.

## Completed

- ERP-specific domain skill: `skills/ba-analyzing-erp/SKILL.md`, loaded conditionally by policy for ERP-tagged projects.
- Human-selectable solution profile: Build Custom, Open Source (Odoo Community / ERPNext), Hybrid, and commercial ERP with explicit license guardrails.
- Separation of installed tech stack from candidate ERP shortlist; proposal reference allow-list.
- Human-audited, version/edition-scoped requirement Fit–Gap assessment; checklist for 8 E2E process areas, migration/controls/localization/SoD/UAT.
- Build/Adopt/Hybrid comparison without invented TCO, cost or product capabilities.
- Project-scope UI, APIs, SQLite-backed state, historical per-project exports, PRD/BRD/SRS and canonical appendix.
- Invalidation of stale proposals/BA review following profile or Fit–Gap changes.
- New regression tests; backward compatibility with v3.7 legacy non-ERP decision fingerprints.

## Resume instructions for Codex/Claude

1. Run `npm run session:bootstrap`, and use `--project <uuid>` when operating within a customer project.
2. Read `docs/ERP_SOLUTION_INTELLIGENCE_V3_8.md`, `docs/RECOMMENDATION_ASSISTED_CLARIFICATION_V3_7.md` and the project's `ERP_DISCOVERY.md`, `ERP_FIT_GAP.json`, `ERP_SOLUTION_COMPARISON.md`.
3. Do not repeat completed project-scoped Fit–Gap evaluations whose requirement digest + profile digest are current; check actual source/evidence before relying on them.
4. Verify `npm run eval:erp && npm run test:serial` after edits. Preserve existing v3.5 handoff/checkpoint protocol.
5. Avoid claiming an ERP feature exists without tested target version/edition; AI suggestions and demo output are NOT human-verified requirements.

## Still outstanding

- Live OpenAI / Codex analysis on approved ERP test corpus and human semantic evaluation.
- Real Odoo/ERPNext sandbox connector or MCP tests; edition-specific module catalog and localization validation.
- Formal BPMN As-Is/To-Be models, detailed data migration mapping, ERP UAT test execution, vendor/TCO cost model and signed customer decision workflow.
- Tenant-grade access controls and multi-host HA.

## Next safe task

Run 20–50 real ERP BA scenarios (distribution across Lead-to-Cash, Procure-to-Pay, Inventory, MRP, Accounting/Record-to-Report), compare Fit–Gap against tested Odoo Community/ERPNext sandboxes; obtain BA adjudication and regulatory expert review before claiming Senior ERP BA readiness.
