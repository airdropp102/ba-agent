# Làm rõ yêu cầu và đề xuất phương án

## Luồng hiện tại

1. Gap Analysis phát hiện câu hỏi còn mở. UI hiển thị theo priority/status, cho phép trả lời riêng hoặc theo batch.
2. Người dùng yêu cầu AI tạo business-answer drafts mà không cần khai báo stack. API technical mode vẫn dùng stack/candidate đã khai báo; không tự suy luận công nghệ đang cài.
3. Với `selectionMode:"ba-draft"`, AI xếp hạng một option hợp lệ và UI điền lựa chọn nháp. Người dùng kiểm tra, đổi phương án hoặc nhập câu trả lời riêng rồi bấm lưu. Generation không ghi approval.
4. Server validate toàn bộ lựa chọn, authority, evidence và version; lưu câu trả lời/quyết định cùng audit. BA UI có thể dùng decision-log nội bộ; customer authority cần danh tính và bằng chứng tương ứng.
5. Quyết định đặt `requirementsRefreshPending=true`, vô hiệu review và đầu ra phụ thuộc. Chạy workflow/re-analysis rồi BA Review trước khi xuất tài liệu tiếp.
6. Quyết định cũ giữ trong lịch sử SQLite và workspace archive. Thay question/stack làm proposal stale; không dùng approval cũ cho nội dung mới.

BA decision không phải customer signoff. Quote chỉ chứng minh có nội dung trong nguồn, không chứng minh chính sách đã được ký duyệt. Suggestions không tự trở thành source evidence hoặc FR được xác nhận.

## Endpoints

`POST /api/projects/:id/tech-stack`:

```json
{"techStack":{"frontend":["React"],"backend":["Node.js"],"database":["PostgreSQL"],"mobile":[],"infrastructure":[],"integrations":[],"constraints":["On-premise required"]}}
```

`GET /api/projects/:id/recommendations` returns project tech stack, proposals, and recorded decisions.

`POST /api/projects/:id/recommendations/generate` generates drafts based on the latest analyzed questions and configured stack. In demo mode it uses deterministic, explicitly labeled templates rather than real model inference.

`POST /api/projects/:id/recommendations/approve`:

```json
{"questionId":"Q-001","optionId":"OPT-Q-001-1","approverRole":"ba","sourceReference":"ADR-025 / BA workshop 2026-10-13","rationale":"Reuses existing permissions middleware and avoids duplicate identity infrastructure."}
```

For `approverRole:"customer"`, also include `customerRepresentative:"Person who approved"` and verifiable documentation in `sourceReference`. All project mutation endpoints support the existing `If-Match: <project version>` CAS strategy. An option from another project, a stale question/stack, or an unconfigured stack is rejected; role authority is attested by authenticated reviewer token if configured. Local unauthenticated mode is not sufficient for externally verifiable approval.

## Giao diện và business drafts

The Analysis UI now presents full-width collapsible questions, priority/status filters, inline sourced customer responses, and explicit option approval forms. The Tech Stack editor is removed from the UI; stored stacks and manual APIs remain compatible.

Use `POST /api/projects/:id/recommendations/generate` with `{ "mode":"business", "questionId":"Q-001" }` for opt-in business-answer drafts without a declared stack. Business mode requires empty `stackReferences`, labels feasibility UNKNOWN, and never recommends an automatic selection. Unknown question IDs reject. Generating for one question preserves other current proposals. Default/technical mode retains the original declared-stack/candidate requirement. Exact option selection still requires authority, evidence and rationale, invalidates review and sets `requirementsRefreshPending`.

The UI distinguishes custom customer-attributed answers from BA/customer-attested proposal approval. Neither establishes customer baseline sign-off. No external generation occurs merely by opening the form.

## Batch clarification

The UI can request suggestions for all unanswered questions in groups of three, report completed/failed question counts, and retry failed groups. `recommendations/generate` accepts `questionIds` (1–5 unique open IDs) in explicit business mode; a partial provider response fails that group. Other proposals remain intact.

Project-scoped in-memory drafts survive filtering, collapsing questions and re-rendering. They do not survive closing/reloading the page. Default/manual generation does not select an option. The explicitly invoked UI `ba-draft` mode described below may preselect a ranked draft; it never commits approval. Changed question/proposal digests require selection again rather than silently approving new option text.

`POST /api/projects/:id/answers/batch` accepts `{ "answers": [...] }`, with 1–100 unique question IDs. Each item has `kind:"custom"` with answer/respondent/sourceReference, or `kind:"option"` with exact optionId/approverRole/sourceReference/rationale and customerRepresentative when applicable. All entries validate against one current project snapshot before committing. Custom answers remain customer-attributed text; BA choices remain attested decisions, not customer sign-off. Mixed batches bind newly authorized decisions to the resulting brief and invalidate previous review and dependent artifacts. Existing manual endpoints are unchanged.

Save does not call AI. It sets `requirementsRefreshPending=true`; continue the normal workflow or re-analyze once before BA Review/export. Invalid batches leave the persisted project unchanged. Optimistic versioning and lease guards remain authoritative. Workflow cards localize status and distinguish current-step and total-job elapsed time; active animation honors reduced-motion and stops at human gates.


## BA draft selection và attachments

The explicitly invoked UI suggestion actions now send `selectionMode:"ba-draft"`.
AI ranks a valid exact option ID; the browser selects that draft and defaults authority
to BA. Missing/invalid ranking rejects generation for retry rather than calling the
first alternative best. Existing custom answers and manual choices are preserved.
Generation never commits approval; the BA still presses **Lưu câu trả lời**.
Default/manual generation without this flag retains prior behavior.

The form removes source-reference and rationale inputs. An explicit BA UI decision
(`decisionContext:"ba-ui"`, `approverRole:"ba"`) may omit those fields: the server
records an internal BA Studio decision-log reference and a description of the BA
selection, not fabricated external evidence or customer consent. Manual approval
requests retain their previous evidence/rationale requirements. Customer authority
requires a named representative and attached evidence when using this simplified UI.
Custom customer responses retain respondent attribution and record their form origin;
that origin is not independently verified customer evidence or baseline sign-off.
All decisions still invalidate review and require re-analysis before downstream work.

Optional attachments support PDF, DOC/DOCX, XLS/XLSX, PNG/JPG/JPEG/WEBP and existing
text extensions. Up to 10 files per answer, 5 MiB per file, are sent to the existing
project files endpoint with `encoding:"base64"`. Legacy plaintext uploads retain
300 KB limits and UTF-8 read responses. Binary reads return base64 plus encoding;
the UI decodes bytes before download. Files are immutable project-scoped documents,
checksummed and referenced by UUID in answers/decisions. Attaching a file does not
verify its contents or authorize sending it to AI. Upload retries reuse successes
for current selected files; removed files are not included in the saved answer.

## Lưu trữ và kiểm tra

Project state ở SQLite; projection hiện hành ở `02-requirements/clarification-recommendations.json` và `00-admin/TECH_STACK.json`. Draft trong browser không tồn tại qua reload; quyết định đã lưu tồn tại theo project version. Chạy `npm run eval:recommendations` và `npm run test:serial` để kiểm tra guardrails offline; không suy ra usefulness hoặc semantic accuracy của provider thật từ fixture tests.

## Xem yêu cầu được tham chiếu trong câu hỏi

Mã FR trong tiêu đề câu hỏi có bảng chi tiết khi hover/focus trên desktop hoặc chạm trên mobile. Hỗ trợ mã đơn (`FR-001`), dải rút gọn (`FR-001–018`) và dải đầy đủ (`FR-001–FR-018`), với dấu gạch ngang, en dash hoặc em dash. Nội dung lấy từ `analysis.functionalRequirements` của dự án đang mở, gồm ID, tên, mô tả và actor; không gọi AI để suy diễn nội dung.

Dải nhiều yêu cầu có danh sách cuộn. Mã thiếu hiển thị thông báo rõ ràng; không dùng yêu cầu ở dự án khác để thay thế. Bấm mã giữ bảng mở mà không bật/tắt form câu hỏi; Đóng, Escape hoặc bấm ra ngoài sẽ đóng bảng. Nội dung được render bằng text nodes, không thực thi HTML từ nguồn yêu cầu. Bảng dùng native Popover API của trình duyệt hiện đại để hiển thị trên các vùng cuộn.
