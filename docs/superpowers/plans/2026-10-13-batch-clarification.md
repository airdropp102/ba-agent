# Batch clarification and workflow status plan

Approved in-chat design: opt-in AI suggestions for all unanswered questions in small groups with per-question success/failure; persistent in-page drafts and save >=1 complete answer in one transaction; modern responsive animated status with real elapsed times and no invented AI percentage.

Use superpowers:executing-plans inline. Preserve legacy APIs, UUID/Q IDs, evidence attribution and exact selected option IDs; drafts never imply approval. No customer transmission in verification.

- [x] Add atomic mixed-answer batch endpoint validating all items against one current snapshot. Save sources/decisions once; mark requirementsRefreshPending and invalidate review; defer re-analysis to a single workflow pass.
- [x] Add bounded multi-question generation and preserve existing proposals; UI orchestrates small batches, exposes counters and retry for failed IDs.
- [x] Store project-scoped in-memory form drafts across filters/render; sticky Save N complete answers; incomplete drafts preserved.
- [x] Add responsive workflow cards, localized status, completed/current/pending timeline and motion only for active state, honoring reduced-motion.
- [x] Tests, fresh review, isolated Chrome DEMO verification, required offline evaluations, restart and handoff.
