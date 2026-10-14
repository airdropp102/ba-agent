# BA Studio → Figma v3 (operator-controlled)

The workflow uses **UI UX Pro Max** to guide design choices and **TalkToFigma MCP** through logged-in Codex CLI to create editable Figma nodes. It does not guarantee native Figma prototype reactions.

1. Analyze → BA Review; export canonical JSON, BRD/SRS, manifest.
2. `node scripts/figma-design.mjs --project UUID --platform web` writes files into `DATA_DIR/projects/UUID/04-figma/exports/vVERSION-web/`. The additional `figma-publish-plan.json` lists actions for each SCR-ID and content fingerprint.
3. Open the intended Figma document with Edit access; connect Figma plugin to local WebSocket, select its channel. Extract file key from Figma document URL.
4. `node scripts/figma-design.mjs --project UUID --platform web --publish --channel CHANNEL --figma-file FILE_KEY` invokes Codex. It tells the agent to stop if required MCP tools are unavailable, and instructs it to draw only `create` actions into a new section, report verified Node IDs and never delete previous designs.
5. The backend checks `figma-run-report.json` against the proposed plan and writes a file-key-scoped registry `DATA_DIR/projects/UUID/04-figma/registry/FILE_KEY.json` only if every newly created screen has an agent-reported verified node ID.
6. Re-running with the same unchanged manifest skips already registered screens. Modified screens create versioned replacement frames; old frames are not deleted. **Review leftovers/retired screens in Figma manually.**

### Cautions

- File key comes from the operator command and agent report. The current MCP may not expose an independently verifiable file key, so visual verification of the open document by the operator remains mandatory.
- `verified=true` is a claim in Codex's structured tool report. Application code cannot prove that Figma MCP actually created that node; open Figma and check its node ID/appearance.
- A crash after node creation but before registry update may create duplicates on retry. Inspect Figma before repeating a failed publish.
- Existing registry may become stale if frames are deleted/edited manually. Back up registry and reconcile manually; the workflow does not perform destructive cleanup.
- Use HTTPS/VPN for remote access and never store a Figma channel in Git.
- CLI and MCP APIs can change; align tool names with the installed repo versions.

External tools:
- https://github.com/nextlevelbuilder/ui-ux-pro-max-skill
- https://github.com/grab/cursor-talk-to-figma-mcp


## Configured Codex publish (2026-10-14)

Step 5 uses the same structured Codex runner as BA analysis. `.env` supplies
`CODEX_BIN` and optional `CODEX_MODEL`; the model is passed explicitly using
`--model`, without changing the global Codex configuration. No OpenAI API key is
required for a ChatGPT-authenticated CLI. `CODEX_FIGMA_TIMEOUT_MS` independently
controls publish duration (default 600000, capped at 600000). The analysis timeout
`CODEX_TIMEOUT_MS` remains separate.

The CLI runs with a read-only sandbox in the reviewed design-pack directory so it
can read BRD/SRS/canonical/manifest. Schema/output files remain temporary. Console
progress uses `[BA Progress]` with project, stage, model, PID, elapsed time, byte
counts and a heartbeat every 15 seconds. Raw prompts, model reasoning and MCP
arguments/results are not printed. Timeout and host signals terminate the POSIX
CLI process group. No automatic publish retry is added: inspect Figma for any
frames created before a failure before explicitly trying again.

A fresh report is persisted only after JSON/schema validation, report-to-plan
checks, a current project-version check and an unchanged registry check. The final
commit holds a short project lease and performs checks/renames inside a SQLite
transaction fence against cooperating API/worker/publish writers. The two filesystem
renames are not crash-atomic; inspect artifacts and Figma after an I/O failure. Invalid/stale reports do not replace
the file-scoped registry or delete a prior accepted report. A retained report is
previous evidence, not success for a failed retry. Accepted reports still represent operator claims;
independent read-back and human visual QA remain required. The offline tests use
mock CLI processes and temporary fixture projects, never live Figma nodes.

This optimization does not install UI UX Pro Max, TalkToFigma or the Figma plugin.
The existing script still requires those tools and an operator-verified file and
channel. Merely having an official Figma MCP configured does not establish the
TalkToFigma tool contract required by this script.


## BA Studio local relay setup

The Prototype setup flow starts and stops the bundled TalkToFigma-compatible relay from BA Studio. Install Bun and configure `BUN_BIN` (default `bun`) if it is not on PATH. The relay binds only to `127.0.0.1:3055`; it does not print WebSocket payloads. BA Studio and the Figma desktop app/plugin must run on the same computer.

After starting the relay in Prototype, open the TalkToFigma plugin manually in the target Figma file and connect it to the local socket. Copy the channel ID shown by the plugin into BA Studio together with the Figma file link. `npm run doctor -- --figma` checks the Bun runtime and the vendored local-safe relay source; it cannot verify that the plugin is open or joined to a channel.

The relay protocol is pinned to `grab/cursor-talk-to-figma-mcp` revision `ddd90f3a6d454ea0b2fc29f1b084f50fd062b880`; see `vendor/talk-to-figma-relay/NOTICE.md`. Revalidate join, message, and progress_update compatibility before changing that revision.

## Prototype tab review workflow

The Prototype tab exposes the managed local relay and version-bound design review. Click **Start socket cursor-talk-to-figma-mcp** to run the bundled relay at `127.0.0.1:3055`. This route is disabled when BA Studio binds to a non-loopback host. Bun must be installed; set `BUN_BIN` if it is not available on PATH.

The user opens the target Figma file, starts TalkToFigma and connects it to the relay manually. BA Studio does not open the Figma plugin or infer its channel. The user enters the HTTPS Figma file link and the channel ID shown by the connected plugin. On Continue, BA Studio queues a single-attempt Figma design job. The worker runs a read-only channel/file preflight, builds editable frames with Codex + UI UX Pro Max, verifies frame reports, exports bounded JPEG previews and stores them under `DATA_DIR/projects/<uuid>/04-figma/exports/v<version>-<platform>/previews/<run UUID>/`.

The Prototype tab displays the generated draft by screen with the FR IDs, preview and Figma frame link. The reviewer can approve the exact manifest digest and project version, or request changes and send a revision back to the same connected channel. Only the approved screen set appears in the approved Figma gallery. These design decisions remain separate from BA Review and customer sign-off. The HTML click-through prototype stays available alongside the Figma gallery.

A failed job is not automatically retried because Figma may already contain partial frames. Inspect the Figma file before submitting another attempt. The UI reports failed state and keeps the input available for an explicit retry. Relay status and offline tests do not prove that the Figma plugin is connected or that a human has inspected the result.

### Scoped Codex tool authorization

After explicit operator approval, set `CODEX_FIGMA_TOOL_APPROVAL=true` to apply the fixed 27-tool TalkToFigma allowlist in `src/figma-codex-policy.js` only to Figma subprocesses. BA analysis calls receive no approval overrides; the user-level Codex configuration is not edited. Each subprocess receives per-tool approval settings and the shell sandbox remains read-only. Delete tools are excluded. The connection preflight exposes only join/document/selection tools; preview export exposes only join/document/node/export tools. Each subprocess rejoins its channel because MCP connections are not shared between CLI calls.

Approval denial returns `MCP_APPROVAL_REQUIRED`; missing plugin connectivity or file-key evidence returns its own failure code. A file key supplied by the operator must never be reported as if it were read from the plugin. If the installed plugin cannot expose the actual file key, stop unless the operator explicitly confirmed the exact file and channel for this run. This confirmation is bound to project UUID/version/run ID/file key/channel digest, recorded in the audit, and labeled OPERATOR_FILE_CONFIRMATION_NOT_INDEPENDENT_ATTESTATION. It resolves only a connected plugin with FILE_KEY_UNAVAILABLE and an empty reported key; it never overrides a mismatched file, disconnected plugin, approval denial or missing MCP. Each new run requires a fresh explicit confirmation. Native navigation and customer approval remain separate human gates.

## Native preview export and failed-preview recovery

BA Studio exports preview bytes through the pinned local relay protocol with a read-only join/export client. PNG/JPEG bytes are bounded, signature-checked, checksummed and stored with their native MIME type; they are not copied through model output. The review set includes only current prototype screen IDs, so supplemental DRAFT screen suggestions cannot become approved screens through this flow.

For an explicitly authorized failed preview run with a valid file/channel confirmation and matching registered frames, run `node scripts/figma-recover-previews.mjs --project UUID --version CURRENT_FAILED_VERSION --confirm`. Recovery reads the immutable source revision, rejects changed requirements/file/channel/current version, requires every review screen to be a registry skip action, re-exports previews, and commits a new WAITING_FOR_REVIEW revision with audit and recovery report. It never draws, rewrites the failed job record, approves a design, or changes customer signoff. Source-version snapshots remain read-only.

## Editing an approved design

The approved gallery includes an explicit edit request with required feedback. REQUEST_CHANGES can reopen the exact currently approved project version and manifest; stale approvals or blank feedback are rejected. The previous approval and frame references remain historical evidence. A new revision requires the connected channel and explicit file confirmation, creates new frames in a versioned section, and returns to WAITING_FOR_REVIEW. A prior approval never automatically approves the new revision or supplies customer signoff.

## Prototype replaces the manual workflow panels

The BA workflow now ends at `DELIVERABLES` with state `COMPLETED`. It no longer schedules a separate Figma Design Pack or manual Figma publish stage. The Workflow UI links to Prototype, which owns setup, drawing, revision and version-bound design review. Drawing still prepares its internal grounded handoff on demand.

Existing manual-run checkpoints, files, approvals and registry history remain stored. Historical manual API routes remain compatible for existing integrations, but no longer appear as actions in the application. Viewing an old project does not migrate or replay its workflow.
