---
name: ba-designing-figma
description: Use when designing editable Figma prototype screens from reviewed BRD, SRS and traceable UI screen requirements.
---

# Figma designs from BRD/SRS

**REQUIRED BACKGROUND:** Use Superpowers:brainstorming to understand unresolved UI choices; do not substitute style decisions for requirement confirmations.

## Inputs
- BRD.md and SRS.md plus canonical.json and figma-manifest.json (schemaVersion ba.figma.v1)
- Explicit operator-selected platform (web/mobile), active Figma document and plugin channel
- Installed nextlevelbuilder/ui-ux-pro-max-skill and grab/cursor-talk-to-figma-mcp MCP

## Workflow
1. Check `review.baReviewed=true`, but remember `customerApproved=false` and `baselineStatus=NOT_BASELINED`.
2. Read the BRD/SRS and traced screen manifest. Preserve SCR and FR identifiers; do not invent missing business rules.
3. Follow UI UX Pro Max SKILL.md to derive design system based on business context, platform, UX, accessibility. Record design assumptions separately from requirements.
4. Use the Figma MCP tools: join_channel, get_document_info, get_selection, create_section, create_frame, create_text, create_rectangle, styling/layout operations. Create only in a new section; never destructively modify current content.
5. Add draft tags for unresolved requirements. Inspect each created frame with get_node_info / get_nodes_info and include verified node IDs in report.
6. Preserve navigation as traceable intent. Never promise native clickable prototype links if tool calls cannot create and verify them; use visual annotations when necessary.

## Stop conditions
Missing review, missing screen references, MCP unavailable, Figma plugin disconnected, wrong document, unapproved destructive action or node creation failure → STOP and report blocker. Do not fabricate successful tool outputs.

## Output
Figma layer frames for each SCR, design system summary, verified Figma node IDs, FR coverage, outstanding questions and a list of unimplemented prototype interactions.
