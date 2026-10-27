# Initial Word/PDF requirement attachment

**Goal:** Create a project from a Word or text PDF file without typing its requirements.

**Approved scope:** The user selected “Chỉ cần Word và PDF” after reviewing the proposed local extraction, preview, optional typed input, original-file retention and 5 MiB limit. Word means DOC and DOCX. Scanned PDFs need OCR and are rejected with an actionable message. Existing typed creation remains supported.

**Architecture:** A local preview endpoint extracts text without saving a project or invoking AI. Creation re-extracts the original bytes and checks the preview digest, so browser text cannot replace the file's evidence. A staged immutable file and a single SQLite transaction commit the project, document registry and audit. File extraction runs in a bounded worker. The existing workflow starts only on the create action.

**Constraints:** Node >=22.13.0. One file, 5 MiB; extracted/combined brief at most 100,000 characters. Preserve original bytes, checksum, document UUID and actual source ID. Uploaded text is untrusted source material, never customer sign-off. Never record its contents in telemetry. Project UUID directories only. No external model calls in preview/tests. Existing manual APIs stay compatible.

## Inline execution checklist

### 1. Local extraction

Files: `src/requirement-file.js`, `src/requirement-file-worker.js`, `tests/requirement-file.test.js`, `tests/helpers/requirement-fixtures.js`, `package.json`, `package-lock.json`.

- [x] Write failing tests using generated PDF and DOCX bytes: `await extractRequirementFile({filename:'brief.pdf',encoding:'base64',content:pdf.toString('base64')})` must return actual text and SHA-256. Cover malformed base64, disguised file types, size/character limits and scan-only PDF.
- [x] Run `node --test tests/requirement-file.test.js` and observe failure.
- [x] Implement `extractRequirementFile(upload) -> {filename,text,sha256,textSha256}` using PDF.js and word-extractor in a worker with a timeout and memory ceiling; reject rather than truncate content.
- [x] Re-run extraction tests and inspect all results.

### 2. Creation and provenance

Files: `src/server.js`, `src/project-workspaces.js`, `src/production-store.js`, `tests/requirement-file-http.test.js`, `tests/v36-project-workspaces.test.js`.

- [x] Write failing HTTP tests: POST `/api/requirements/preview` returns text but creates no project/usage; POST `/api/projects` with `requirementFile` and `previewTextSha256` creates a file-only project; its source points to the immutable document and checksums. Invalid preview/attachment leaves no project. Legacy typed creation still succeeds.
- [x] Add transactional rollback coverage: a document-registry insertion failure must roll back the initial project and audit.
- [x] Run the new tests and observe failures before implementing the endpoints and transactional document creation.
- [x] Re-extract on create; require an exact preview digest, reject combined brief overflow. Give typed notes and extracted text separate source records with stable IDs.
- [x] Re-run targeted tests, including project isolation and retrieval of unchanged original bytes.

### 3. Initial form and verification

Files: `public/index.html`, `public/app.js`, `public/requirement-file-ui.js`, `public/style.css`, `tests/requirement-file-ui.test.js`, `docs/PROJECT_WORKSPACES.md`.

- [x] Test file-only submission, removal, replacement while an earlier preview is pending, error recovery and optional typed notes.
- [x] Add an accessible file button, selected filename/removal, loading/error status and read-only extracted preview. Preserve typed notes when changing files. Reset attachment state for a new/sample project.
- [x] Submit original bytes plus preview digest. Keep creation disabled while extraction is pending or failed. Start workflow after project/document commit.
- [x] Document endpoint payloads, limits and OCR limitation.
- [x] Run `npm run doctor`, `npm test`, `npm run test:serial`, `npm run eval`, `npm run eval:quality`, `npm run eval:figma-contract`, `npm run eval:production`, `npm run eval:workspaces`; inspect UI and persist test evidence.
- [x] Checkpoint and hand off the engineering task with remaining limitations stated accurately.
