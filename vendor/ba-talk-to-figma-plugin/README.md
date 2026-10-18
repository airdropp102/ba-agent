# BA Studio TalkToFigma + Assets

1. Unzip this package to a permanent local directory.
2. In Figma Desktop choose Plugins → Development → Import plugin from manifest… and select manifest.json.
3. Close the old TalkToFigma plugin. Run BA Studio TalkToFigma + Assets, start BA Studio's local socket, then Connect.
4. Use the new Channel ID in Prototype. Choose Iconify collection links or direct asset links, save the Design Brief, then explicitly draw the sample with visual-input consent.

This is a local development fork of the pinned MIT-licensed TalkToFigma plugin. It retains existing MCP commands and adds bounded asset capability/import/read-back commands. SVG is imported as vectors; PNG/JPEG as image fills; WebP is converted locally to PNG. No upstream analytics are sent. The default relay port is 3055.

The plugin snapshot rejects asset insertion into frames that existed before the current run, slots outside their planned screen and closed runs. The server must validate bytes and file identity before sending an import command. Plugin reports are operator reports, not independent attestation. Inspect the actual sample before approval. Failed runs can leave partial frames and must not be blindly retried.

If importing an older package fails with `Invalid value for allowedDomains` mentioning `ws://127.0.0.1:3055`, download this package again and replace the extracted files before re-importing. The development manifest uses `allowedDomains: ["none"]` and localhost only in `devAllowedDomains`, matching the UI socket URL.

## Socket connection troubleshooting

Start the local relay in BA Studio → Prototype and wait for READY before pressing Connect in the plugin (port 3055). Keep BA Studio running on the same machine. The plugin shows a Channel ID only after the relay acknowledges joining that channel. Copy the newly shown ID into BA Studio after reconnecting.

If Connect does nothing in an older package, replace its `ui.html` with this version or download/extract the ZIP again and re-import `manifest.json`; close and reopen the plugin. This version restores explicit DOM bindings for the Connect, tab and progress controls, prevents duplicate connection attempts and gives an eight-second timeout instead of hanging. The UI reports connection failures with local relay and Figma Local Network Access guidance. Allow local network access if Figma/browser asks. No manifest widening, external downloads or drawing are required to establish a socket connection.
