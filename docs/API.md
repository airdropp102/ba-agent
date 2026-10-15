# API hiện tại

Base mặc định `http://127.0.0.1:3478`. Route source: `src/server.js`. Các bảng là nhóm chức năng hiện có; server validation là hợp đồng cuối cùng cho payload và errors.

## Quy ước

- JSON request: `Content-Type: application/json`.
- Project UUID lấy từ `/api/projects`; không dùng title làm ID/path.
- Project mutation gửi `If-Match: <version>`. Thiếu header khi `REQUIRE_IF_MATCH=true` trả 428; stale version/lease hoặc state conflict trả 409.
- Public API dùng `Authorization: Bearer <BA_STUDIO_TOKEN>`. Route reviewer dùng `X-BA-Reviewer-Token` khi identity requirement bật.
- Input không hợp lệ thường trả 400; thiếu auth 401; thiếu tài nguyên 404. Lỗi provider/workflow có thể 502/504; xem safe code và job/audit trước retry.
- Response của Figma/jobs có redaction channel/revision metadata theo route; không lưu payload hoặc token vào source control/log ngoài chính sách.

## Hệ thống và project

| Method | Route | Mục đích |
|---|---|---|
| GET | `/api/status` | Provider/runtime/quality policy; không phải chứng nhận live MCP |
| GET | `/api/metrics` | Job metrics và aggregate AI metadata |
| GET / POST | `/api/projects` | Liệt kê / tạo `{title, brief}` |
| GET | `/api/projects/:id` | Current authoritative project |
| GET | `/api/projects/:id/history[/:version]` | Lịch sử / snapshot chỉ đọc |
| GET | `/api/projects/:id/audit` | Audit events và chain integrity |
| GET | `/api/projects/:id/workspace` | Workspace metadata/version |
| GET / POST | `/api/projects/:id/files` | List / upload `{category, filename, content, encoding?}` |
| GET | `/api/projects/:id/files/:documentId` | Nội dung có kiểm tra checksum và project scope |

Plaintext tối đa 300 KB, binary base64 tối đa 5 MiB theo validation; UI Tài liệu hiện giới hạn TXT/MD/JSON/CSV, clarification attachment UI hỗ trợ thêm binary. Các tệp thuộc project UUID; tên tệp không được vượt root hoặc dùng traversal.

## Workflow, analysis và đầu ra

| Method | Project-relative route | Mục đích |
|---|---|---|
| GET | `/workflow` | Workflow + blockers + quality + brainstorm |
| POST | `/workflow/jobs` | Enqueue `{auto, platform}`; lựa chọn chính của UI |
| GET | `/workflow/jobs[/:jobId]` | Jobs/attempts/result; không phải project approval |
| POST | `/workflow/advance` | Synchronous advance, auto hoặc một bước |
| POST | `/workflow/restart` | `{confirm:true, platform?}`; reset review/prototype hiện tại, giữ lịch sử |
| POST | `/workflow/waiver` | `{blockerIds, rationale}` cho toàn bộ current High blockers |
| POST | `/analyze` | Phân tích lại; invalidates downstream state |
| POST | `/clarify` | Ghi chú BA, không coi là trusted customer response |
| POST | `/answers` | Customer-attributed answer cho câu hỏi |
| POST | `/answers/batch` | Batch custom/option decisions đã validate |
| POST | `/review` | `{approved:true, notes}`; BA Review, không customer signoff |
| POST | `/generate` | API manual tạo prototype; giữ tương thích các guards |
| GET | `/export/:kind` | PRD/BRD/SRS/prototype/JSON/canonical/questions/Figma artifacts theo allowlist |

Ví dụ export thông dụng: `prd.md`, `brd.md`, `srs.md`, `prototype.html`, `canonical.json`, `questions.md`. Except questions/canonical, export route yêu cầu BA Review và không pending refresh. Manual endpoints được giữ để tương thích; không suy ra chúng thực hiện toàn bộ orchestrated quality gate.

## Clarification và ERP

| Method | Route | Nội dung |
|---|---|---|
| POST | `/api/projects/:id/tech-stack` | Actual installed stack và downstream invalidation |
| GET | `/api/projects/:id/recommendations` | Proposals/decisions |
| POST | `/api/projects/:id/recommendations/generate` | `mode`, `questionIds`, `selectionMode` theo guards |
| POST | `/api/projects/:id/recommendations/approve` | Exact question/option, approver role, rationale/evidence/context |
| GET | `/api/erp/catalog` | Candidate catalog và process groups trong source |
| GET | `/api/projects/:id/erp` | Profile, assessment và comparison |
| POST | `/api/projects/:id/erp/profile` | `solutionProfile` |
| POST | `/api/projects/:id/erp/fit-gap` | Human classification + version/edition/evidence |

Payload đầy đủ và authority constraints: [Clarification](CLARIFICATION.md), [ERP](ERP.md).

## Quality và AI usage

GET `/api/projects/:id/quality`, `/quality/history`, `/quality/ai`. Giá trị null giữ nghĩa chưa biết/không áp dụng; dashboard không đổi thành 0. Score/rates là deterministic checks. p95 phải được hiểu cùng sample size, known cost có thể chỉ là một phần tổng chi phí.

## Figma hiện tại

| Method | Route | Nội dung |
|---|---|---|
| GET | `/api/figma/relay` | Relay lifecycle |
| POST | `/api/figma/relay/start`, `/stop` | Loopback-only managed Bun process |
| GET | `/api/projects/:id/figma-design` | Design/job hiện tại |
| POST | `/api/projects/:id/figma-design` | `{fileUrl, channelId, fileIdentityConfirmed}` hoặc revision `{revisionNotes, channelId, fileIdentityConfirmed}` |
| POST | `/api/projects/:id/figma-design/review` | `{decision, notes, projectVersion, manifestDigest}`; APPROVE hoặc REQUEST_CHANGES |
| GET | `/api/projects/:id/figma-design/previews/:screenId` | PNG/JPEG được kiểm tra scope/checksum |

Review đổi project version. Client phải đọc lại sau mutation, không reuse version/digest của bản trước. Revision giữ documentKey của thiết kế đang chỉnh và nhận channel hiện tại.

## API Figma legacy

`POST /api/projects/:id/workflow/figma/sync`, `/challenge`, `/readback`, `/qa` còn phục vụ dữ liệu và operator tooling cũ. Chúng cần legacy workflow/design state phù hợp; không tạo luồng publish thủ công mới trong UI. Nonce read-back scoped và single-use; visual QA vẫn là BA attestation, không customer signoff. Không gọi chuỗi legacy này để thay thế flow Prototype hiện tại.

## Tra cứu FR lịch sử trong câu hỏi

`GET /api/projects/:id/requirement-references` trả `{projectId, projectVersion, requirements}`. Mỗi item gồm `id`, `name`, `description`, `actor`, `historicalVersion`. Chỉ lấy FR không còn trong analysis hiện tại, chọn snapshot mới nhất chứa đúng mã. Route áp dụng auth/read scope của project, không ghi dữ liệu và không suy luận ID thay thế. UI đối chiếu projectVersion, ưu tiên yêu cầu hiện tại và ghi rõ bản lịch sử. Đây không phải xác nhận ngữ nghĩa của liên kết câu hỏi–FR.
