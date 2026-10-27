# Multiple initial requirement attachments

**Goal:** Extend the existing approved Word/PDF intake to multiple files, as requested by the user.

**Scope:** Up to 10 DOC/DOCX/text PDF files; 5 MiB per file, 20 MiB total, and the existing 100,000-character combined brief limit. Select several at once or add more later. Each file has its own preview, error/warnings and removal action. Typed notes remain optional with readable attachments. All original files and their source records commit with the new project in one transaction; reject rather than partially save an invalid batch. Existing typed and singular-file APIs remain compatible. No OCR or external AI calls during preview.

**Architecture:** Keep the existing per-file preview endpoint and parser limits. The browser processes files sequentially, retaining per-file drafts and discarding results for removed/cleared entries. Creation accepts `requirementFiles: [{filename,encoding,content,previewTextSha256}]`. The server validates batch counts/bytes, re-extracts every file and verifies each preview digest before staging anything. `createWithDocuments(project, [{file,sourceId}])` stages all originals, assigns separate document UUIDs to source records and commits an `initialDocuments` array in one SQLite transaction. Clean up all staged files on staging/transaction failure. Preserve singular wrappers for compatibility.

## Inline plan

### 1. Batch creation and persistence

Files: `src/requirement-file.js`, `src/server.js`, `src/project-workspaces.js`, `src/production-store.js`, `tests/requirement-file-http.test.js`, `tests/v36-project-workspaces.test.js`.

- [x] Add failing HTTP tests creating two files with notes, asserting `SRC-001/002/003`, distinct original document UUIDs and exact contents; reject a bad second digest with no project/documents saved.
- [x] Add count, aggregate-byte and combined-text limit tests; reject mixed singular/plural payloads while retaining the existing singular test.
- [x] Add a persistence test that fails the second registry insert and asserts zero project/documents/audit and an empty attachment directory; also verify cleanup when staging the second file fails.
- [x] Run the targeted tests and observe failures before implementation.
- [x] Implement `createWithDocuments` and transactional `initialDocuments`, preserving singular wrappers; implement plural request validation and per-file source construction.
- [x] Re-run targeted tests and verify rollback/source isolation.

### 2. Multiple-file form

Files: `public/requirement-file-ui.js`, `public/index.html`, `public/style.css`, `tests/requirement-file-ui.test.js`.

- [x] Test `await draft.add([first,second]); draft.remove(id)` retains the other file's upload/digest; further `add` calls append rather than replace.
- [x] Test removal/clear during pending extraction cannot restore the removed file. Block submit for pending/error entries, and enforce count/byte limits before encoding or preview requests.
- [x] Implement per-file draft IDs and a sequential preview queue. Render independent filename/remove/status/preview/error rows using DOM text nodes; enable native multiple selection and preserve typed notes.
- [x] Verify file-only creation, file error recovery, repeated selections, pending removal and mobile layout in Chrome with synthetic documents and workflow execution intercepted.

### 3. Documentation and completion

Files: `docs/ARCHITECTURE.md`, `docs/PROJECT_WORKSPACES.md`, this plan; private evidence in `data/setup-evidence/requirement-multifile-20261026/`.

- [x] Update limits, plural payload and transactional persistence documentation.
- [x] Run `npm run doctor`, `npm test`, `npm run test:serial`, `npm run eval`, `npm run eval:quality`, `npm run eval:figma-contract`, `npm run eval:production`, `npm run eval:workspaces` and `git diff --check`.
- [x] Checkpoint test/browser evidence, refresh local service after checking active jobs, and hand off the engineering task.
