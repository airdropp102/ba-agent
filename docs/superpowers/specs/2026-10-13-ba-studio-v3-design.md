# BA Studio v3 — reliability and Codex/Figma handoff design

Status: approved by user's request to implement improvements following v2 evaluation; scope limited to local-first delivery.

## Purpose
Protect traceability through multiple BA elicitation rounds, allow a logged-in local Codex CLI as an alternative to an API key, and prevent duplicate/unverified Figma publication. Keep existing v2 projects and exports functional.

## Boundaries
- Requirement IDs for FR, NFR, BR, Q stable across reorder and conservative exact matches; never reuse retired IDs. Detect rather than guess collisions.
- Capture sources per original brief and subsequent clarifications, with classification and timestamp; evidence source is a quote match, NOT business sign-off. BA notes alone do not validate requirement certainty.
- Preserve previous versions and expose read-only history. Clarification/re-analysis invalidates BA review/prototype.
- AI backend modes `demo`, `openai`, `codex` (via `codex exec` in unique read-only temporary workdir, structured JSON, timeout, output size bounds). Codex login belongs to system operator.
- Figma export remains explicit operator publish; optional file-key-scoped registry records only tool-verified nodes, skip unchanged published screen content, redraw changed screens into revision section, no blind node deletion. Offline planning does not claim live Figma success.
- Security is local-only by default; reject remote binding without a configured secret and disallow remote requests without authorization. No multi-tenant claims.

## Canonical contract
Preserve `ba.canonical.v1` with backwards-compatible supplemental source and revision metadata; generate the same BRD, SRS, Figma manifest from the same project.

## Tests
Stable ID reorder/new requirement/deletion, provenance segregation, version snapshot retrieval, invalid/no token on remote, Codex fake CLI invocation and timeout, Figma incremental planned actions/registry validation; retain existing tests.

## Limitations
No live Figma account or authorized user session is available for online verification here. No database/multi-user RBAC, and native Figma click-through is not promised.
