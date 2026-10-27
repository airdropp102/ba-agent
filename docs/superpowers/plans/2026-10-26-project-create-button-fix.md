# Fix project creation blocked after file selection

User report: create-and-run remains disabled; file summary says “Đã đọc 0/2”. Local server logs show two filename validation failures. Synthetic reproduction on the running service accepts `Yêu cầu.docx` but rejects the same bytes as `Yêu cầu (1).docx` and `BRD [final] & Quy trình.docx` with HTTP 400. This is a validation regression in the attachment flow, not a reason to bypass unreadable-file guards.

The old preview and workspace filename regexes accept only letters, digits, spaces, dots, hyphens and underscores. Use one basename/extension validator for both paths; retain original printable names in metadata, reject separators/control characters and unsupported extensions. Store new original bytes as document UUID plus extension to avoid filesystem byte-length failures for long Unicode names. Continue reading old registry paths. Show a count of failed files and explain the disabled state beside create-and-run.

- [x] Reproduce filename-based rejection on the live local preview endpoint with synthetic bytes; save `reproduction.json` without customer content.
- [x] Add failing extraction and workspace tests for punctuation and long Unicode names, plus path/control rejection and original-name round trips.
- [x] Implement shared `documentExtension` validation and UUID storage names; preserve project scope, file checksums, signature checks and legacy registered paths.
- [x] Add a failing UI test for `requirementCreateBlocker`, then show pending/error reasons and failed-file count without bypassing validation.
- [x] Verify a browser can select two punctuated Word/PDF names, reach “Đã đọc 2/2”, enable create-and-run and persist both originals under their original display names. Test error recovery using a scan-only PDF and intercept workflow execution.
- [x] Run doctor, full tests, serial tests, offline quality/Figma/production/workspace evaluations and diff checks.
- [x] Checkpoint and hand off; refresh local service only after checking no active/queued workflow work.
