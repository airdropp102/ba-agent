# BA Studio v3.6 — Claude Session Continuity / Project Isolation

Read `AGENTS.md` (shared contract) and `docs/SESSION_CONTINUITY_V3_5.md` before editing. At session start **run `npm run session:bootstrap`** and inspect the repository working tree. If the result is `RESUME`, present the candidate task with ID and `next` to the user; choose it explicitly before claiming it. If multiple active tasks, select the intended task rather than guessing. If `RECONCILE`, stop and inspect evidence/drift before proceeding. If `NEW_TASK`, create a task.

Run `npm run session:checkpoint -- --file /path/to/checkpoint.json` after every substantive milestone, including actual evidence artifacts. Treat task version and session ID as write fences. On handoff / before leaving / before compaction, run `npm run session:handoff -- --task <uuid>`; project hooks under `.claude/settings.json` may automatically export the latest **committed** state, but cannot reconstruct unrecorded thought. Do not say a task is completed without verified evidence and a passing latest checkpoint. Never ingest secrets into checkpoint JSON.

The project provides optional hooks; project approval and CLI version may affect whether they run. Do not assume hooks fired: use explicit checkpoint/handoff commands as a fallback. `SessionStart` hooks are informational, not authorization to change work.

For BA-project work, bootstrap with `--project <uuid>` and set `BA_ACTIVE_PROJECT_ID=<uuid>` in the hook environment. BA-project evidence paths are relative to `DATA_DIR/projects/<uuid>/`; project handoffs live in `08-sessions/`, not the global `.session-handoff/`. See `docs/MULTI_PROJECT_WORKSPACES_V3_6.md`.

## v3.7 Gap Analysis decisions

On a BA project, read `docs/RECOMMENDATION_ASSISTED_CLARIFICATION_V3_7.md`. Recommend 1–3 grounded technical alternatives only after actual project tech stack is declared. Never approve an option for the user. After a documented BA/customer-attested approval, ensure reanalysis and BA Review before SRS/prototype; keep rejected/stale decision evidence in project history.


## v3.8 ERP business analysis / solution candidates

Read `docs/ERP_SOLUTION_INTELLIGENCE_V3_8.md`. If `solutionProfile.domain=erp`, use the `ba-analyzing-erp` skill: capture As-Is/To-Be, cross-module process ownership, master data, finance/localization, migration, integrations, SoD and UAT. Keep *installed* `techStack` separate from *candidate* ERP platforms. Odoo Community / ERPNext are open source under their respective licenses; Odoo Enterprise is commercial. Never claim module/feature/license/local statutory compliance without version/edition-specific evidence. `ERP_FIT_GAP.json` contains human-attested reviews only; `UNASSESSED` means unverified, not unavailable. Do not auto-approve or invent 3–5-year TCO. On change to ERP shortlist or Fit–Gap evidence, regenerate stale proposals and re-review deliverables. Keep all artifacts scoped to project UUID, and preserve `session:bootstrap` / `session:handoff` discipline. Run `npm run eval:erp` and `npm run test:serial`.
