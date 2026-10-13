# Clarification UX Implementation Plan

> For agentic workers: use superpowers:executing-plans for inline execution.

Goal: Implement the user-approved in-chat design: inline sourced answers, opt-in business draft choices independent of stack, question filters and licensed ERP candidate selection.
Architecture: Preserve existing recommendation and answer APIs. Add explicit business recommendation mode, allow empty technology references only in that mode, retain stale-decision and human approval guards. UI requests suggestions per question to avoid large batches.
Tech stack: Node >=22.13, browser JavaScript, SQLite authoritative.
Spec: User-approved design in this conversation (2026-10-13).

- [x] Test business draft mode with absent stack and invented references; keep legacy technology mode guards.
- [x] Implement scoped generation for one question in both providers and preserve other proposals.
- [x] Remove Tech Stack editor; build inline choice/custom answer forms and priority/status filtering.
- [x] Disable and deselect candidates incompatible with selected strategy, with visible notice.
- [x] Test guardrails and UI behavior; run full regression, recommendations, ERP, serial, production, quality and Figma offline checks.
- [x] Restart server, verify HTTP assets, checkpoint and handoff. Do not send customer data to external models during verification.
