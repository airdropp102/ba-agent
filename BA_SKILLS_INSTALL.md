                                       # BA Skills + Superpowers quick install

**Goal:** Customer brief → BABOK-inspired elicitation → standardized requirements → gap analysis → customer questions → BA review → draft BRD/SRS/prototype.

## 1. Install an agent harness and Superpowers

Install Superpowers for your chosen environment following its official instructions: https://github.com/obra/superpowers . Superpowers is **not bundled** here.

## 2. Register the BA Skills

From this folder:

```bash
mkdir -p ~/.agents/skills
cp -R skills/ba-* ~/.agents/skills/
```

For Claude Code, copy them to `~/.claude/skills/` instead. Restart your agent session.

## 3. Run an elicitation session

Prompt your Superpowers-enabled agent:

> Use ba-orchestrating-analysis and the required BA Skills. Read the provided customer brief; extract only grounded FR/NFR/BR and goals, identify gaps using BABOK v3 Elicitation and Requirements Analysis tasks, ask me questions by priority, and produce a ba.canonical.v1 output after review. Treat unsourced details as hypotheses, not customer approvals.

## 4. Test locally

The complete BA Studio application includes `src/ba-quality.js`, `src/ba-canonical.js` and `scripts/validate-canonical.mjs`. Test with `npm test`; start with `npm start` (Node 20+). Preview examples under `examples/generated/`.

### Boundaries

These are original BA agent instructions, not the BABOK Guide and not a replacement for a human BA. An evidence quote is not approval. The Node v3 server invokes the selected AI provider (Codex CLI or OpenAI) plus deterministic verification; it does **not** invoke the Superpowers plugin internally.

## Optional: Figma design

Use `ba-designing-figma` after BA review for editable Figma frames. Install `ui-ux-pro-max-cli` and `cursor-talk-to-figma-mcp`, then follow `setup.md` section 4. Exports are drafts; `--publish` explicitly requests writes to an open Figma file.
