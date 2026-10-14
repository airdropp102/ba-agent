# Figma design setup and review workflow

Date: 2026-10-14
Status: Design approved; implementation not started.

## Purpose

Add a guided Figma design flow to the Prototype tab. BA Studio starts the local TalkToFigma-compatible WebSocket relay, collects a Figma file link and the channel ID shown by the manually launched Figma plugin, queues design work, and presents per-screen previews for explicit review. Only an approved design version appears in the Prototype tab's Figma design area.

The existing HTML click-through prototype remains available separately. Design approval is an internal approval of a draft visual version. It is not BA Review, customer approval, or customer sign-off.

## Approved user flow

1. On Prototype, the user selects **Thiết lập thiết kế** and starts the local relay.
2. BA Studio reports relay startup state. If Bun or the configured local relay is unavailable, it shows a setup error and keeps the design action disabled.
3. The UI explains that the user must open the TalkToFigma plugin in Figma and connect it to the relay. Figma does not allow BA Studio to launch the plugin.
4. The user enters the Figma file link and the channel ID displayed by the plugin. The UI explains where to find that ID and what it connects.
5. BA Studio accepts only HTTPS links on `figma.com` or its subdomains with a supported `/design/<file-key>` or `/file/<file-key>` path, extracts the Figma file key without fetching the URL, validates the channel ID against the existing 1–128 character letters/digits/underscore/hyphen contract, queues the design job, and displays progress while the configured Codex runner applies UI UX Pro Max and TalkToFigma to the reviewed design pack.
6. The publisher joins the supplied channel and checks `get_document_info` against the extracted file key before creating frames. It creates a new versioned section and does not remove earlier Figma content.
7. The publisher verifies created frame IDs and obtains one image preview for each screen. The run then waits at a human review gate.
8. The review UI groups previews by screen and shows screen ID, mapped FR IDs, Figma node ID, and a link to open the frame. The reviewer can approve the design version or request changes with notes.
9. A change request starts a new versioned design pass, preserves the old frames and review history, and returns to the same review gate.
10. Only screens in an approved version appear in the Prototype tab's Figma design area. The existing HTML prototype is unchanged and remains separately visible.

Static per-screen previews are the approved presentation format. Embedded Figma views are out of scope.

## Components and responsibilities

- **Prototype UI:** relay setup/status, Figma link and channel form, loading/progress view, per-screen draft review, feedback form, and approved-version gallery.
- **Relay manager:** starts, monitors, and stops the local Bun relay process. It uses a fixed executable and fixed arguments, never shell execution or user-provided commands/paths. The relay listens on the local port used by the plugin (default 3055).
- **Workflow API and durable queue:** validates project version, persists job/checkpoint/review state in SQLite WAL, and uses existing fencing leases and audit records.
- **Figma publisher:** reuses the configured Codex CLI, UI UX Pro Max instructions, TalkToFigma MCP, current design pack, and file-key-scoped registry. It verifies document identity before writes and frame IDs after writes.
- **Project workspace:** stores review artifacts and per-screen previews under the immutable project UUID. SQLite remains authoritative; workspace files are projections/artifacts.

The relay must bind to `127.0.0.1` and its stdout/stderr must not persist raw WebSocket payloads. The upstream socket implementation does not provide these properties by default, so implementation must use a small, pinned, protocol-compatible local-safe relay derived from the upstream MIT-licensed socket implementation. Keep the TalkToFigma plugin and MCP tools unchanged. Record the upstream revision and license attribution. Reassess compatibility when updating the pinned revision.

Relay startup is supported only when BA Studio and Figma run on the same host. For remote-bound deployments, the setup action must report that local relay startup is unavailable rather than starting a relay on the remote server.

## State and persistence

Persist design-run state within the project workflow record with a project-version and manifest-digest binding. The state model must distinguish at least:

`NOT_CONFIGURED` → `RELAY_STARTING` → `RELAY_READY` → `WAITING_FOR_FIGMA` → `QUEUED` → `DESIGNING` → `WAITING_FOR_REVIEW` → (`APPROVED` or `REVISION_REQUESTED` → `QUEUED`).

Failures use an explicit `FAILED` state with a safe, actionable error code. Do not report completed design from a process exit alone; require valid report-to-plan coverage, verified unique frame IDs, expected file key, and preview artifacts.

Persist only the Figma file key, active run metadata, channel ID needed by the queued run, review decision, reviewer identity, feedback, manifest digest, and verified frame metadata. Store them project-scoped. Do not put channel IDs, feedback, source text, prompts, MCP payloads, or customer text in execution logs or `ai_invocations`. The full Figma URL should not be retained when the file key is sufficient. Clear transient channel data after the design run is terminal; retain audit decisions and historical design artifact references.

Each approval binds to one exact project version, manifest digest, and set of screen IDs. A new analysis, changed project version, changed manifest, or newer revision invalidates approval for the affected draft. A stale worker result cannot update the current design state.

## Human gates and provenance

- Existing BA Review remains required before building the Figma design pack.
- Figma connection and file-key verification occur before any drawing.
- A failed or missing MCP check does not proceed to Figma writes.
- Reviewer approval is a version-specific design decision and must be attributed/audited. It never changes customer-baseline or customer-signoff fields.
- A revision note is draft design feedback. It does not create or modify a confirmed business requirement.
- Existing independent read-back and human visual QA semantics remain intact. An operator/MCP report alone is not independent attestation.
- Every screen keeps its existing SCR and FR IDs; no renumbering or dropped FR coverage.

## Failure and recovery behavior

- Missing Bun, missing local-safe relay, or occupied relay port: keep the form blocked and show the setup error.
- Plugin not connected, channel invalid, or Figma file mismatch: fail before drawing and allow the user to correct connection inputs.
- Project version or manifest changes during a queued run: reject stale results and retain artifacts only as historical evidence.
- Codex/MCP timeout or partial Figma mutation: mark failed, retain a safe error summary and run metadata, and require inspection before retry to avoid duplicate frames.
- Missing/invalid screen report or preview: do not expose the version for approval or in Prototype; show which screens need repair.
- Reviewer requests changes: preserve current Figma frames and previews; create a new version, then return to review.
- Relay child exit: show the relay as stopped and allow explicit restart.

Do not silently retry a Figma write after a timeout or uncertain partial mutation.

## Scope boundaries

- No automatic plugin launch; Figma requires a user to run the plugin.
- No automatic customer approval or customer baseline change.
- No native Figma prototype reactions are claimed unless implemented and verified separately.
- No deletion or overwrite of previous Figma design sections.
- No change to legacy manual APIs unless needed to keep existing behavior compatible.
- No change to v3.4 quality gates or telemetry.

## Acceptance criteria

- Local relay start/status/stop works with a configured Bun installation and reports the relay bound only to loopback.
- Remote-bound setup is safely disabled; arbitrary command execution and raw payload logging are absent.
- The UI explains manual plugin launch, channel discovery, and Figma URL requirements; non-HTTPS/non-Figma URLs, unsupported paths, malformed file keys, and invalid channels fail before queueing. URL validation parses the string locally and makes no network request.
- Queue recovery, project leases, project-version checks, and design-manifest binding prevent stale commits.
- Each displayed review item maps to a screen ID and its FR IDs; each requires verified Figma node metadata and a usable static preview.
- Approval exposes only the exact approved version in Prototype. Revision feedback starts a new version, preserves history, and requires a new approval.
- Project re-analysis invalidates dependent drafts/approvals without changing requirement identifiers.
- Existing manual workflow/Figma endpoints and HTML prototype behavior remain backward compatible.
- Add offline tests for state transitions, stale approval rejection, retry/partial-write behavior, relay lifecycle, and preview gating. Run the repository-required regression/evaluation commands for the changed surfaces.

## Known limits

The TalkToFigma plugin must still be installed and launched by the user. Static preview export depends on the configured MCP tool returning usable image bytes; failure to export a screen is a hard review blocker. MCP reports and local reviewer identity remain operator-provided evidence, not independent customer attestation. The local relay is intentionally same-host and loopback-only.

## 2026-10-14 live compatibility correction

The installed public TalkToFigma plugin returns current page metadata without a file key. Figma exposes `figma.fileKey` only to private/Figma-owned plugins. The user explicitly supplied the target file link after the new channel was read successfully. Support an explicit, unchecked operator file confirmation in the setup/revision form, bound to project/version/run/file/channel and recorded in audit. This is operator file identity evidence, never independent attestation or customer signoff. Accept this source only when the channel responds and no actual file key is available; reject every observed mismatch, denial or disconnection. Record the identity source alongside the design. All drawing/report/preview coverage and human review gates remain required.

## 2026-10-14 native preview correction

Live export showed the installed plugin always returns PNG, even when the MCP format parameter requests JPEG. Model transcription produced invalid base64. BA Studio therefore retrieves native PNG/JPEG bytes through the pinned read-only relay export protocol, preserving MIME/signature/size/hash checks. Restrict the published review plan to the current prototype screen IDs; supplemental DRAFT placeholders stay outside the approved set. Failed preview recovery is allowed only with matching immutable source requirements, exact current failed version/run and file/channel confirmation, and skip-only registered frames. It records a new audited draft revision and leaves the failed job and source snapshots intact; human design review remains required.
