# BA Studio — Multi-Project Workspaces

## Goal and identity

Each BA project has an immutable UUID and its own isolated on-disk workspace beneath `DATA_DIR/projects/<project-uuid>/`. **Project titles are display-only**; paths never derive from user-supplied titles. The central SQLite `DATA_DIR/ba-studio.sqlite` continues to be authoritative for project revisions, jobs, quality, audit, and session ledger; the workspace contains committed projections and attachments. This is logical/project-scoped isolation **not a separate database or a role-based authorization boundary**.

```
DATA_DIR/
  ba-studio.sqlite                # Shared transactional project registry and queue
  projects/
    <project-uuid>/
      00-admin/PROJECT.json       # Immutable project ID / current metadata projection
      01-customer-input/
        CUSTOMER_BRIEF.md         # Current customer brief + sourced amendment text
        attachments/             # Immutable customer-submitted docs
      02-requirements/
        PRD.md                    # Auto-generated draft; no invented KPI/customer signoff
        BRD.md
        SRS.md
        URD.md                    # Stakeholder requirements view (DRAFT)
        USE_CASES.md              # Cockburn-style use cases / UML associations
        USER_STORIES.md           # Story views, INVEST checklist, draft Gherkin
        canonical.json
        clarification-questions.md
        references/              # Immutable supplemental reference files
      03-prototypes/prototype.html
      04-figma/
        registry/<file-key>.json  # Scoped Figma registry
        exports/<version-platform>/
      05-workflow/
        PROJECT_STATE.json       # Current workflow state projection
        JOB_STATUS.json          # Project-specific queue snapshots
        AUDIT_STATUS.json        # Project-scoped audit and integrity report
        runs/<run-uuid>/          # Design pack: quality + BRD/SRS + manifest
      06-reviews/
        BA_REVIEW.json
        attachments/             # Approval evidence
      07-results/
        QUALITY_HISTORY.json     # Per-project quality snapshots
        AI_USAGE.json            # Per-project token/cost metrics (unknown when unmeasured)
      08-sessions/
        HANDOFF.md                # Latest active task of this project (projection)
        TASK_LEDGER.md
        <task-uuid>/
          HANDOFF.md
          PROJECT_STATE.json
          PROGRESS_LOG.md
          DECISIONS.md
          NEXT_ACTIONS.md
          TEST_RESULTS.json
          SESSION_HISTORY/*.json
      09-archive/
        v000001/state.json        # Immutable versioned project snapshot
        v000002/{state.json,PRD.md,BRD.md,SRS.md}
```

Folders are created on first project commit or via `npm run project:migrate`. Until analysis exists, generated PRD/BRD/SRS do not appear. With analysis, workspace exports may contain DRAFT documents before BA Review; file existence is not approval and HTTP export guards still apply. If a newer analysis invalidates a prototype/review, the **current** generated file is removed; previous valid versions remain archived where captured. All generated BA documents must still be evaluated and approved; mere file existence does not mean customer approval.

## Migration và sửa workspace projection

1. Back up the whole old `DATA_DIR` **while the service is stopped**, including SQLite WAL/checkpoint state and `.workflow-artifacts`, `.figma-registry`, and old `*.json` files.
2. Deploy the current source **in the same DATA_DIR** and run `npm run project:migrate`.
3. Migration also re-exports project-scoped session handoffs from committed SQLite checkpoint history; legacy engineering-root evidence may be flagged `RECONCILE` until manually re-bound. Run `npm run project:status`. Check representative project folders and compare project/version against `GET /api/projects/:id`.
4. Run `npm run test:serial` and restart the service. Do not manually delete original `.figma-registry` or legacy workflow-artifacts until dependent older workflow runs are resolved; migration is copy-only for registry. Existing `workflow.artifactDir` can still reference the legacy directory until a new design pack is produced.

Rollback requires the matching source, database and artifact backup from before migration. Older source may not understand newer records. Do not overwrite current data with an older database alone. Multi-host / NFS SQLite and atomic multi-file transactions are unsupported.

## Operator commands

```bash
npm run setup
npm run project:migrate
npm run project:status
npm run project:status -- --project <project-uuid>

# Project-specific agent session
npm run session:bootstrap -- --project <project-uuid>
npm run session:new -- --scope ba-workflow --project <project-uuid> --title "Analyze customer onboarding" --runtime codex
npm run session:checkpoint -- --file /secure/checkpoint.json
npm run session:handoff -- --task <task-uuid>

# To activate one project for optional SessionStart/PreCompact hooks:
BA_ACTIVE_PROJECT_ID=<project-uuid> npm run session:bootstrap -- --project <project-uuid>
```

`checkpoint.json` for a BA-bound task uses **artifact paths relative to the project directory** rather than the repository root:

```json
{
  "taskId": "<task-uuid>",
  "sessionId": "<session-uuid>",
  "expectedVersion": 1,
  "summary": "Reviewed interview notes",
  "completed": [{"id":"INTERVIEW-1","title":"Collected customer brief","artifacts":["01-customer-input/CUSTOMER_BRIEF.md"]}],
  "next": ["Validate functional requirements against sources"],
  "decisions": [], "risks": [], "checks": []
}
```

Projectless engineering tasks continue to live in the global `.session-handoff/`; project-scoped tasks are written **only** inside `08-sessions/`. Bootstrap without `--project` gives a cross-project overview and requires choosing explicitly when multiple active tasks exist. Project directory files are not magically a transcript; the last committed checkpoint is the recovery boundary.

## HTTP API

- `GET /api/projects`: global project registry (unchanged).
- `POST /api/projects`: create project and its directory automatically. The existing `{title,brief}` and singular `{title,brief?,requirementFile:{filename,encoding:"base64",content},previewTextSha256}` payloads stay supported. Multiple initial Word/PDF files use `{title,brief?,requirementFiles:[{filename,encoding:"base64",content,previewTextSha256}]}` with 1–10 files, at most 5 MiB each, 20 MiB total and 100,000 combined brief characters including notes/file markers. Do not send singular and plural fields together. Preview each file first; the server validates batch limits, re-extracts all originals and checks each preview text digest before creating anything. Typed notes and each file have separate source IDs in selection order. Each file source retains its distinct document UUID, filename, original SHA-256 and extracted-text SHA-256, even for repeated filenames. The new project, all document registry entries and audit commit in one SQLite transaction after staging the immutable originals; a staging/transaction failure removes all staged files. A process crash before commit can leave unregistered files, which are never treated as evidence. As with all workspace attachments, backups must include the original files. In the form, select several files together or add more later; an unreadable file must be removed or fixed before submission, while the other file previews and typed notes remain intact.
- `POST /api/requirements/preview`: locally extracts one Word (`.doc`, `.docx`) or text PDF from `{filename,encoding:"base64",content}`; returns `{filename,text,sha256,textSha256,warnings}`. It does not save a project/file or call AI. Maximum 5 MiB, 100,000 extracted characters, 200 PDF pages and 15 seconds of parsing; content is rejected rather than silently truncated. Empty/scanned PDFs require OCR, password-protected or malformed files reject. Mixed PDFs warn about pages without readable text. Verify tables, reading order, headers and text boxes in the preview; extraction is not a visual or semantic attestation. Clicking create-and-run sends the combined brief to the configured AI through the existing workflow.
- `GET /api/projects/:id/workspace`: location + current project version of workspace projection.
- `GET /api/projects/:id/files`: list supplemental documents belonging **only** to this project.
- `POST /api/projects/:id/files`: add UTF-8 file `{ "category":"customer|reference|approval", "filename":"notes.md", "content":"..." }`; 300 KB max, extensions `.md/.txt/.json/.csv`. Binary attachments additionally accept `encoding:"base64"` with the supported document/image extensions and a 5 MiB decoded limit; see [Clarification](CLARIFICATION.md). Original display names may contain spaces, parentheses, brackets and other printable punctuation (up to 255 characters); path separators and control characters are rejected. New attachments use `<document-uuid>.<extension>` on disk, preserving the original name in metadata and avoiding filesystem filename-byte limits. Existing registered paths remain readable without migration. The server records a SHA-256 digest and audit event.
- `GET /api/projects/:id/files/:document-uuid`: read with checksum verification; cross-project document IDs return 404.
- `GET /api/projects/:id/export/prd.md`: download draft PRD (requires BA Review and no pending requirements refresh, like BRD/SRS export).
- `GET /api/projects/:id/export/{urd,use-cases,user-stories}.md`: additional DRAFT documents with the same current BA Review and refresh guards as BRD/SRS. Sources, canonical IDs and unanswered questions remain visible; story/use-case aliases are derived views, not newly approved requirements.
- `GET /api/document-templates/{brd,srs,urd,use-cases,user-stories}.md`: download an original blank Markdown template. Contains no project data; project review is not required. See [template reference mapping](DOCUMENT_TEMPLATES.md).

All six document outputs (including existing PRD) are current projections in `02-requirements/`. Newly created version archives include the new outputs; exporting with the new templates never appends files to existing historical snapshots. An interrupted initial archive write can leave incomplete projection files; SQLite version history remains authoritative. A template change updates current drafts, not old snapshot contents.

File paths never accept traversal, absolute names, or symlinks as evidence. Uploaded content is *untrusted customer data*, not executable instructions. UI includes a PRD tab and a project documents panel.

## Acceptance and limitations

- Check two projects can be created and docs/checkpoints never appear in the other project's workspace.
- Verify immutable UUID-based documents, project ID-scoped access, SHA mismatch detection, migration copies, status and QA invalidation.
- Run `npm run eval:workspaces` and `npm run test:serial`.
- SQLite transactions cannot atomically commit all filesystem files. The project DB is canonical and `npm run project:migrate` can rebuild generated projections after a crash or projection failure. Never interpret stale output as authoritative; compare `PROJECT_STATE.json.version` against SQLite.
- Backups **must include `data/projects/` and legacy paths as well as SQLite**. No live model/Figma acceptance is implied by offline regression.

Trade-off: UUID project directories and one shared SQLite reduce moving parts and make per-project documents inspectable; they do **not** provide independent customer tenancy/authorization. Risk: a crash between SQLite commit and writing project files leaves temporary projection staleness; resolve via `project:migrate` and version checks.
