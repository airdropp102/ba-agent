# BA Studio v3.3 — Production Workflow Engine

## Scope

Upgrade the v3.2 single-agent BA workflow to a resilient **single-host / multi-process** application. SQLite WAL is the transactional canonical store; async workflow jobs are persisted and leased; reviewer decisions and Figma read-back are audited. **No new autonomous Figma publisher** and no claim of independent Figma verification.

```text
Browser → HTTP API (src/server.js) → SQLite WAL (projects, versions, jobs, leases, audit, challenges)
                                  ↘ enqueue durable workflow job
Worker (embedded or scripts/worker.mjs) → atomic lease claim → single-agent workflow
                                                       ├─ checkpoint/project revision + audit (transaction)
                                                       ├─ Codex CLI / OpenAI / DEMO provider
                                                       ├─ human gate (clarification / BA Review)
                                                       └─ locally generated Figma Design Pack
Figma operator (Codex CLI + TalkToFigma MCP) → node registry (external JSON)
       → Figma sync → nonce-bound MCP operator read-back → BA visual QA → audit
```

## Storage and concurrency

- Node.js >=22.13: built-in `node:sqlite` (no native npm dependency); in Node 22 this module may print an `ExperimentalWarning`.
- `data/ba-studio.sqlite` WAL with `synchronous=FULL`, `busy_timeout=5000`. Legacy `*.json` imported idempotently and mirrored for CLI compatibility; the projection is **not canonical**.
- `projects` uses optimistic DB `revision` and project business `version`. Every successful save archives the previous version and appends a per-project hash-chained audit event **inside the same SQLite transaction**.
- `project_leases`: per-project fencing token, expiry and heartbeat. Concurrent HTTP writers/workers cannot save while another valid lease exists. Lost leases invalidate in-flight writers at save time.
- `workflow_jobs`: at-least-once job delivery (`QUEUED`, `RUNNING`, `RETRY_WAIT`, `SUCCEEDED`, `DEAD_LETTER`), three attempts by default, capped exponential retry delay, crash recovery, and expired-lease reclamation. Exhausted attempts cannot be claimed again.
- Job status update and workflow checkpoint are **different commits**. If the process dies between them, worker can re-execute the current stage; completed checkpoints are not repeated if stage progression was committed. External AI calls might be repeated (not exactly-once).
- Recovered `currentAttempt` markers are recorded as `ABANDONED`. Do not rely on PID liveness recovery across network hosts: workers share the **same host-local database** only.

## Reviewer identity / audit

- `REQUIRE_REVIEWER_IDENTITY=true` requires `X-BA-Reviewer-Token` matching an identity in `BA_REVIEWER_TOKENS_JSON` at reviewer-controlled endpoints (risk waiver, BA Review, Figma sync/read-back, Figma QA, audit viewing).
- For remote binds, reviewers must authenticate; `BA_STUDIO_TOKEN` is required for all remote APIs. Deploy behind HTTPS reverse proxy/VPN. There is **no production-grade OIDC/RBAC/multi-tenancy**.
- Audit event includes time, project, actor, decision details and hash chain. Detects unintentional modification but is **not tamper-proof against a privileged database administrator**; no external signature/anchor is present. Audit route also returns `valid`, `count`, `tipHash`.
- Customer approval is never inferred from risk acceptance, internal BA review or Figma visual QA.

## Figma handoff trust boundary

1. BA-approved workflow generates immutable-ish local design artifacts in `.workflow-artifacts/<project>/<runId>` and enters `AWAITING_FIGMA`.
2. Operator explicitly publishes by Codex/MCP. A verified-node **operator report** is stored in `.figma-registry` (not a cryptographically signed Figma record).
3. `/workflow/figma/sync` checks manifest screen digests and registry; state becomes `FIGMA_REPORTED`.
4. `/workflow/figma/challenge` issues an expiring (5-minute), single-use random nonce scoped to project, runId, Figma file key, manifest and node IDs.
5. `scripts/figma-verify.mjs` uses **read-only Codex** and available MCP `get_document_info` + `get_node_info` to report file/frame identity; `/workflow/figma/readback` validates scope, frame type/name and node IDs. **Nonce consumption and project+audit update are atomic.** State `FIGMA_READBACK_REPORTED` is an **operator-reported read-back, not independent attestation**.
6. BA personally checks actual Figma file and approves via `/workflow/figma/qa` with >=20-character notes; state `FIGMA_QA_APPROVED` means **BA_VISUAL_QA_APPROVED_NOT_CUSTOMER_SIGNOFF**.

MCP tool discovery/capabilities and connected plugin sessions cannot be verified offline. The read-back JSON can be falsified by an operator with endpoint access, and visual design correctness cannot be programmatically certified by node identity checks alone.

## API additions

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/status` | GET | Engine/provider status |
| `/api/metrics` | GET | Aggregated job count, states, retries, completion rate and latency |
| `/api/projects/:id/workflow/jobs` | POST | Enqueue one active workflow run job; body `{ "auto": true, "platform": "web" }` |
| `/api/projects/:id/workflow/jobs` | GET | Latest jobs + attempts/status |
| `/api/projects/:id/workflow/jobs/:jobId` | GET | Individual job |
| `/api/projects/:id/audit` | GET | Reviewer audit + integrity check |
| `/api/projects/:id/workflow/figma/challenge` | POST | Issue scoped nonce (`documentKey`) |
| `/api/projects/:id/workflow/figma/readback` | POST | Consume nonce with scoped operator MCP report |
| `/api/projects/:id/workflow/figma/qa` | POST | Human visual QA (`approved`, `notes`) |

Legacy `/workflow/advance` stays available synchronously for compatibility, but the UI now prefers durable queue execution. `If-Match` is optional unless `REQUIRE_IF_MATCH=true`.

## Operation

```bash
npm run setup         # Preflight: Node >=22.13, provider, network, reviewer setup
npm test              # Regression + v3.3 production tests
npm run eval:production
npm run eval           # Earlier offline guardrails
npm run eval:semantic  # DEMO proxy metric only, not true semantic accuracy
npm run setup:start   # API + embedded worker, local-first default
```

**Separate worker option:** start API with `BA_WORKER_ENABLED=false npm start`, then `npm run worker` against the same `DATA_DIR` and provider credentials. Workers on multiple **processes on the same local machine** coordinate through SQLite leases. Use a supervised process manager; do not put WAL files on NFS/SMB.

**Backup:** `npm run backup` uses SQLite `VACUUM INTO` for a consistent project/audit/queue snapshot (and verifies SQLite integrity). Also back up the Figma registry and `.workflow-artifacts` directories, which are external to the DB. Test restore procedures in a disposable environment. Treat all data as sensitive and encrypt backup volumes.

## Measurable acceptance and remaining limitations

- Target offline test pass rate: **100% across project regressions and production integration tests**. Exercise dual-server job uniqueness, crash replay, stale writers, challenge replay and human gates.
- Operational SLO to set with production traffic: successful workflow run rate, lease loss rate, job latency `updated_at - created_at`, dead-letter count, AI cost and Figma QA rejection rate. These **have not yet been measured in a real workload**.
- Edge cases: power loss under abnormal filesystem semantics, long AI call timeouts and retry-side effects, corrupted/untrusted external Figma registry, no DB encryption-at-rest, no independent reviewer authentication authority, audit not externally anchored, same-host limitation, no proven load tests.
- Recommended next hardening: OIDC authorization, encrypted backup/rotation/restore drills, signed event anchoring, observability dashboards, durable artifact storage, live MCP contract tests. A multi-agent BA orchestrator is not justified by the observed requirements.
