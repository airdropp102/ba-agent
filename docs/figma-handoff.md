# BA Studio → Figma v3 (operator-controlled)

The workflow uses **UI UX Pro Max** to guide design choices and **TalkToFigma MCP** through logged-in Codex CLI to create editable Figma nodes. It does not guarantee native Figma prototype reactions.

1. Analyze → BA Review; export canonical JSON, BRD/SRS, manifest.
2. `node scripts/figma-design.mjs --project UUID --platform web` writes files into `.figma-exports/UUID-vVERSION-web/`. The additional `figma-publish-plan.json` lists actions for each SCR-ID and content fingerprint.
3. Open the intended Figma document with Edit access; connect Figma plugin to local WebSocket, select its channel. Extract file key from Figma document URL.
4. `node scripts/figma-design.mjs --project UUID --platform web --publish --channel CHANNEL --figma-file FILE_KEY` invokes Codex. It checks MCP availability and tells the agent to draw only `create` actions into a new section, report verified Node IDs and never delete previous designs.
5. The backend checks `figma-run-report.json` against the proposed plan and writes a file-key-scoped registry `data/.figma-registry/UUID/FILE_KEY.json` only if every newly created screen has an agent-reported verified node ID.
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

## BA Studio local relay setup

The Prototype setup flow starts and stops the bundled TalkToFigma-compatible relay from BA Studio. Install Bun and configure `BUN_BIN` (default `bun`) if it is not on PATH. The relay binds only to `127.0.0.1:3055`; it does not print WebSocket payloads. BA Studio and the Figma desktop app/plugin must run on the same computer.

After starting the relay in Prototype, open the TalkToFigma plugin manually in the target Figma file and connect it to the local socket. Copy the channel ID shown by the plugin into BA Studio together with the Figma file link. `npm run doctor -- --figma` checks the Bun runtime and the vendored local-safe relay source; it cannot verify that the plugin is open or joined to a channel.

The relay protocol is pinned to `grab/cursor-talk-to-figma-mcp` revision `ddd90f3a6d454ea0b2fc29f1b084f50fd062b880`; see `vendor/talk-to-figma-relay/NOTICE.md`. Revalidate join, message, and progress_update compatibility before changing that revision.
