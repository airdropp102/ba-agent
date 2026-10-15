# Thành phần và trách nhiệm

Tài liệu đi cùng [Kiến trúc](ARCHITECTURE.md). Các đường dẫn trỏ tới implementation hiện tại; không phải danh sách khả năng dự kiến.

## 1. Giao diện

| File | Chi tiết |
|---|---|
| `public/index.html` | Shell sidebar, project search, mobile menu, welcome form, tabs và vùng render; giữ DOM IDs cho handlers |
| `public/style.css` | Design tokens, layout responsive, focus/reduced motion, trạng thái, upload và quality dashboard |
| `public/app.js` | Authenticated fetch, `If-Match`, project restore, UI state, route actions, render các tab; không quyết định approval thay server |
| `public/workflow-progress.js` | Poll job/project, elapsed time và status; không bịa phần trăm tiến độ |
| `public/clarification-ui.js` | Biểu mẫu từng câu hỏi, authority, lựa chọn và attachment |
| `public/clarification-batch-ui.js` | Nhóm sinh gợi ý, project-scoped draft, retry/upload tracking và batch payload |
| `public/figma-review-ui.js` | Ánh xạ relay/design/job sang UI state, lỗi dễ hiểu, approved-only gallery và preview URL |

Các tab: Tổng quan, Phân tích, PRD, BRD, SRS, Prototype, Tài liệu. Tổng quan có workflow, chất lượng và AI usage. Prototype có Figma và HTML wireframe riêng. Tài liệu bổ sung cho phép chọn nhóm/tệp và tải lại; thông tin lưu trữ/checksum nằm trong disclosure.

Project/tab gần nhất lưu ở localStorage; access/reviewer token ở sessionStorage. Draft trả lời tồn tại trong bộ nhớ theo project, không bảo đảm giữ sau reload. Tìm kiếm dự án hỗ trợ không dấu; mobile menu vẫn cho phép chọn/tạo dự án. `design-system/ba-studio/` ghi lựa chọn thiết kế và kiểm tra giao diện.

## 2. HTTP và orchestration

### `src/server.js`

Composition root: nạp môi trường, tạo store/workspaces/relay/preview store, đăng ký telemetry sink, phục vụ static allowlist và HTTP routes. Các hàm chính:

- `newAnalysis`: gọi provider, validate/normalize và cập nhật yêu cầu/provenance.
- `createPrototype`: sinh và normalize screens, duy trì SCR ID, cập nhật trạng thái GENERATED.
- `advanceWorkflow`: chạy stage tới human gate hoặc terminal; lưu RUNNING intent trước tác vụ.
- `tickWorker`: claim job, heartbeat, phân biệt BA job và `kind:figma-design`, finalize dưới token.
- Route mutation: auth, reviewer, `If-Match`, project lease, validation, audit và save.

Đây là module lớn tích hợp HTTP và worker. `scripts/worker.mjs` đặt worker-only env rồi import cùng module; không có orchestration thứ hai.

### `src/intelligent-workflow.js`

Sáu stage chính, workflow initialization, checkpoint, unresolved blockers, signed waiver scope, downstream invalidation, completeness snapshot và design coverage helpers. Legacy Figma stage IDs chỉ giữ cho dữ liệu cũ/invalidation; không được lên lịch mới sau DELIVERABLES.

## 3. Yêu cầu, provenance và tài liệu

| Module | Input → output / trách nhiệm |
|---|---|
| `schemas.js` | JSON schemas cho analysis, prototype và recommendation output |
| `model-output.js` | JSON provider → kiểm tra schema, keys, kiểu và giới hạn kích thước/chuỗi |
| `normalize.js` | Output hợp lệ → analysis/prototype nhất quán, IDs và liên kết hợp lệ |
| `revisions.js` | Fingerprints, stable IDs, sources, evidence và revision helpers |
| `ba-quality.js` | Analysis → gap findings, questions, quality status theo rule |
| `quality-intelligence.js` | Project → score/rates/findings/PASS–REVIEW–BLOCK và policy; null dimension không tính thành 100% |
| `ba-canonical.js` | Project → canonical contract trong `schemas/ba-canonical-v1.schema.json` |
| `docs.js` | Project → PRD, BRD, SRS và questionnaire DRAFT |
| `export.js` | Project prototype → HTML standalone click-through, không phải app nghiệp vụ thật |
| `brainstorm.js` | Schema/demo/validation cho DRAFT hypotheses riêng khỏi confirmed FR |

### Clarification và ERP

`clarification-recommendations.js` normalize stack, tính digest câu hỏi/stack/profile, validate options và ghi quyết định đúng option/authority. Chế độ business khác technical. Chế độ `ba-draft` được UI gọi rõ ràng có thể xếp hạng/chọn **draft**; thao tác đó chưa ghi approval. Lưu câu trả lời vẫn là hành động của người dùng.

`clarification-batch.js` validate cả batch trên cùng snapshot rồi áp dụng; invalid batch không lưu một phần câu trả lời. Attachment upload là thao tác riêng nên các tệp đã upload có thể vẫn tồn tại nếu batch bị từ chối.

`erp-intelligence.js` chứa catalog, process discovery, profile/strategy constraints, human Fit–Gap và comparison rendering. Catalog là thông tin trong source, không phải kiểm chứng trực tiếp mọi module/version của vendor. Xem [Clarification](CLARIFICATION.md) và [ERP](ERP.md).

## 4. AI adapters và quan sát

| Module | Cách hoạt động |
|---|---|
| `ai-provider.js` | Chọn demo/OpenAI/Codex, cung cấp analyze, prototype, brainstorm, recommendation; bọc measurement |
| `demo.js` | Fixture có giới hạn; brief không phù hợp không được coi là live analysis |
| `openai.js` | Structured API requests cho các operation; cần key cấu hình |
| `codex-provider.js` | Spawn executable tin cậy, schema/output tạm, model override tùy chọn, timeout/heartbeat và process termination |
| `ai-telemetry.js` | AsyncLocalStorage context, invocation ID, usage/cost/latency metadata, sink tới store |
| `execution-log.js` | Allowlisted progress metadata: stage/model/ID/time/count/error code; không dump prompt/reasoning/MCP payload |

`DEMO_MODE` khác `'false'` chọn demo. Khi tắt demo, `AI_PROVIDER` quyết định adapter. Token/cost thiếu không chuyển thành 0. Giá do operator cấu hình không phải hóa đơn provider được đối soát. Worker Figma dùng structured Codex runner riêng; không nên suy luận dashboard AI đã đo đầy đủ mọi chi phí MCP/CLI nếu provider không báo usage.

## 5. Storage

`production-store.js` quản lý SQLite WAL và transactions; optimistic revision, project-version archive, lease/token fencing, jobs/retries, audit chain, nonce và quality/usage queries. `save` là ranh giới commit authoritative; mirror/export theo sau không biến filesystem thành nguồn chính.

`project-workspaces.js` ánh xạ UUID → thư mục, tạo các projections, ghi attachment immutable và metadata/checksum, đọc có kiểm tra scope/integrity, migrate dữ liệu legacy. UI Tài liệu hiện tải text tối đa 300 KB; API/clarification attachment còn hỗ trợ base64 binary tối đa 5 MiB. Binary attachment không được tự parse hoặc gửi AI chỉ vì đã upload.

`session-continuity.js` quản lý **engineering work**, khác project workflow. Task/session/checkpoint có version fence, evidence SHA, chain và export handoff. Resume cần task ID, version và runtime cụ thể. Drift phải reconcile có lý do; hook chỉ export checkpoint đã commit.

## 6. Figma pipeline

| Module | Trách nhiệm / kiểm tra |
|---|---|
| `figma-relay.js` | Start/stop Bun child, loopback-only, port availability, readiness và lỗi an toàn |
| `vendor/talk-to-figma-relay/socket.ts` | Relay protocol pinned; vận chuyển message giữa MCP/plugin/client |
| `figma-handoff.js` | Reviewed project → design brief, manifest, tài liệu và instructions cho agent |
| `figma-registry.js` | Fingerprint plan create/skip; validate report, node IDs, duplicate IDs, file-scoped registry |
| `figma-publisher.js` | Preflight, prompt thiết kế, structured report validation và previews; không tự coi operator report là attestation độc lập |
| `figma-codex-policy.js` | Fixed 27-tool allowlist, subsets theo phase; không có delete tools; opt-in cho Figma subprocess |
| `figma-design-review.js` | URL/channel parsing, run/file confirmation scope, screen/FR/preview coverage, version-bound approve/revise |
| `figma-preview-export.js` | Read-only local relay join/export; nhận bytes trực tiếp không copy ảnh qua model output |
| `figma-preview-store.js` | Immutable bounded PNG/JPEG, MIME/signature/checksum, UUID path và safe read |
| `figma-design-recovery.js` | Exact failed-version recovery từ registry skip frames; không vẽ/duyệt lại tự động |
| `figma-readback.js` | Validate nonce-bound report cho API legacy |
| `figma-mcp-contract.js` | Offline/read-only capability and result contract probes |

Relay process nằm trong HTTP server; standalone worker dùng loopback relay của cùng host để export previews. Plugin phải được người dùng mở/kết nối. File key không có trong plugin response chỉ được xử lý bằng scoped explicit operator confirmation khi các điều kiện khác đã đạt.

## 7. Tooling và evaluation

| Nhóm | Entry points |
|---|---|
| Khởi động | `bootstrap.mjs`, `doctor.mjs`, `load-env.mjs`, `worker.mjs` |
| Dữ liệu | `backup.mjs`, `project-workspaces.mjs`, `project-purge.mjs` |
| Session | `session-continuity.mjs`, `session-hook.mjs` |
| Figma operator | `figma-design.mjs`, `figma-verify.mjs`, `figma-recover-previews.mjs`, `figma-crosscheck.mjs` |
| Offline QA | `evaluate.mjs`, `evaluate-quality.mjs`, `evaluate-semantic.mjs`, `evaluate-figma-contract.mjs`, `validate-canonical.mjs` |
| Live acceptance | `live-acceptance.mjs` + `src/live-acceptance.js`; explicit transmission permission, human review và acceptance policy |

CLI Figma/manual read-back là công cụ tương thích và phục hồi, không phải các bước bắt buộc mới trên giao diện. Xem [API](API.md) và [Vận hành](OPERATIONS.md).
