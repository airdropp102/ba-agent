# BA Studio v3.4 Changelog

## Added
- Deterministic weighted BRD/SRS evidence/traceability/coverage rubric; conditional strict workflow gate.
- Review-pending classification for unwaived High clarifications or absent BA sign-off.
- Atomic, deduplicated quality snapshot history; SQLite schema migration v4.
- Context-scoped AI invocation ledger with token-usage capture when available, operator USD rates, partial-cost safety and latency/usage aggregates; SQLite migration v3.
- Read-only Figma MCP probe contract and optional live Codex CLI check; offline positive/negative tests.
- Configurable expert corpus evaluator with fail-on-threshold CLI flags and machine-readable JSON output.
- Workflow UI Quality Intelligence / FinOps panel, quality trend and findings.
- New v3.4 regression tests and documented limitations.

## Compatibility
- All v3.3 workflow stages and existing endpoints retained.
- `BA_QUALITY_ENFORCE=false` by default (opt-in, no surprise blocking on upgraded deployments).
- No external npm runtime dependency added; Node.js >=22.13 still required.
- No silent provider pricing defaults; unknown token/cost fields represented as `null`.
