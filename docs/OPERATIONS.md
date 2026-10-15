# Vận hành BA Studio

## Môi trường và khởi động

Cần Node.js >=22.13 với `node:sqlite`, filesystem local và trình duyệt. Chạy từ thư mục repository:

```bash
npm run setup
npm run doctor
npm run setup:start
```

Setup tạo `.env` từ mẫu nếu chưa có, giữ cấu hình đã tồn tại, tạo thư mục dữ liệu và chạy doctor. Setup không tự cài Node, Bun, Codex hoặc plugin Figma. Mặc định truy cập `http://127.0.0.1:3478`. Dừng foreground bằng Ctrl+C.

## Cấu hình

| Nhóm | Biến | Ý nghĩa |
|---|---|---|
| HTTP | `HOST`, `PORT` | Mặc định loopback, cổng 3478 |
| Dữ liệu | `DATA_DIR` | Cùng một đường dẫn tuyệt đối cho server, worker và CLI; mặc định `data/` |
| AI demo | `DEMO_MODE=true` | Fixture offline; không chứng minh chất lượng mô hình thật |
| AI thật | `DEMO_MODE=false`, `AI_PROVIDER` | Chọn `codex` hoặc `openai` |
| OpenAI | `OPENAI_API_KEY`, `OPENAI_MODEL` | Credential riêng ngoài Git |
| Codex | `CODEX_BIN`, `CODEX_MODEL`, `CODEX_TIMEOUT_MS` | CLI đã đăng nhập; model override tùy chọn |
| Figma | `BUN_BIN`, `FIGMA_RELAY_HOST`, `FIGMA_RELAY_PORT` | Relay local mặc định 127.0.0.1:3055 |
| Figma runner | `CODEX_FIGMA_TIMEOUT_MS`, `CODEX_FIGMA_TOOL_APPROVAL` | Timeout riêng; allowlist chỉ bật sau operator approval |
| Queue | `BA_WORKER_ENABLED`, `BA_JOB_POLL_MS` | Embedded worker hoặc worker riêng |
| HTTP security | `BA_STUDIO_TOKEN`, `REQUIRE_IF_MATCH` | Token khi bind ngoài loopback; yêu cầu project version khi chia sẻ API |
| Reviewer | `REQUIRE_REVIEWER_IDENTITY`, `BA_REVIEWER_TOKENS_JSON` | Ánh xạ reviewer credential, tách khỏi token ứng dụng |
| Quality | `BA_QUALITY_ENFORCE`, `BA_QUALITY_MIN_SCORE` | Gate tùy chọn ở orchestrated DELIVERABLES |
| Usage | `BA_AI_COST_RATES_JSON`, `BA_AI_ALERT_RUN_USD` | Giá do operator xác thực; thiếu giá/usage là UNKNOWN |
| Log | `BA_LOG_PROGRESS` | Metadata tiến độ; không ghi prompt hoặc nội dung khách hàng |
| Session | `BA_ACTIVE_PROJECT_ID` | Giới hạn hook/bootstrap vào UUID dự án |

Xem `.env.example` cho cú pháp. Không dùng mức giá 0 trong ví dụ để thay UNKNOWN. AI provider thật gửi nội dung phục vụ phân tích ra ngoài máy; corpus nghiệm thu có quy trình cấp quyền riêng trong [LIVE_ACCEPTANCE](LIVE_ACCEPTANCE.md).

## HTTP và durable worker

Mặc định HTTP process có worker. Nếu muốn tách process, cấu hình HTTP với `BA_WORKER_ENABLED=false`, rồi chạy `npm run worker` trong terminal khác với cùng `DATA_DIR` và provider configuration. Worker riêng không mở HTTP. Lease/fencing phối hợp các process trên cùng host; không dùng SQLite WAL trên NFS/SMB.

UI gửi job rồi poll trạng thái. Job SUCCEEDED có thể chỉ có nghĩa workflow đã tới human gate. Kiểm tra cả workflow state, không chỉ job state. BA jobs có retry giới hạn; Figma jobs chỉ một attempt vì side effect bên ngoài không thể rollback. Managed relay thuộc HTTP process; khởi động lại HTTP có thể yêu cầu plugin Connect lại.

## Sao lưu và khôi phục

`npm run backup` kiểm tra integrity và dùng SQLite `VACUUM INTO` tạo snapshot nhất quán trong `DATA_DIR/backups` hoặc `BA_BACKUP_DIR`. Snapshot này chưa chứa attachments, registry, previews hoặc workspace files.

Để sao lưu đầy đủ, dừng mọi writer, tạo SQLite snapshot và sao lưu `DATA_DIR/projects/`, dữ liệu legacy còn dùng và session handoff liên quan cùng cấu hình được bảo vệ. Không sao chép riêng file SQLite đang mở mà bỏ WAL. Mã hóa backup và thử restore vào thư mục riêng.

Khôi phục khi server/worker đã dừng: dùng database snapshot cùng bộ artifact tương ứng, đặt `DATA_DIR` đúng, chạy doctor và `npm run project:status`. Không ghép database cũ với artifact mới rồi coi là cùng checkpoint. `npm run project:migrate` sửa projection workspace; không replay workflow để tái tạo trạng thái đã hoàn tất. Session evidence drift cần reconciliation có lý do; xem [SESSION_CONTINUITY](SESSION_CONTINUITY.md).

## Chẩn đoán

| Hiện tượng | Kiểm tra / xử lý |
|---|---|
| Không thấy dự án cũ | Xác định server đang phục vụ cổng nào và `DATA_DIR`; đọc `/api/projects`; không tạo database mới thay dữ liệu cũ |
| Conflict/stale version | Tải lại project; gửi đúng version; không bỏ If-Match để ép ghi |
| Chờ mãi ở clarification/review | Xem gate và câu hỏi/đánh giá còn thiếu; đây có thể là trạng thái chờ người dùng hợp lệ |
| Queue chưa chạy | Worker enabled, cùng DATA_DIR, lease và job error; không chỉnh lease trực tiếp trong DB |
| Relay READY nhưng vẽ lỗi | Mở đúng file, plugin Connect, lấy channel mới và xác nhận file; READY chỉ chứng minh relay chạy |
| MCP approval denied | Cấp quyền đúng scope sau operator approval; không dùng file confirmation để vượt denial |
| Vẽ lỗi sau khi đã tạo frame | Xem frame hiện có trước retry; không tự xóa hoặc retry hàng loạt |
| Chỉ lỗi preview | Dùng quy trình recovery có kiểm tra version/registry trong [Figma](figma-handoff.md) |
| Usage/cost UNKNOWN | Provider không báo hoặc thiếu giá; không diễn giải thành miễn phí |

## Xóa dữ liệu

Dừng server và mọi worker dùng DATA_DIR trước. `npm run project:purge` chỉ xem trước. Chỉ khi chủ dữ liệu yêu cầu xóa toàn bộ project mới dùng `npm run project:purge -- --confirm`. Lệnh giữ cấu hình và engineering sessions toàn cục, không xóa backup hoặc dữ liệu đã gửi ra dịch vụ ngoài. Nếu cleanup filesystem chưa xong sau DB commit, đọc báo cáo rồi chạy lại confirm để xử lý thư mục `.purge-<uuid>`. Không dùng purge để sửa lỗi giao diện không hiện dự án.

## Phát triển và kiểm tra

Trước thay đổi, bootstrap rồi chọn NEW_TASK hoặc RESUME rõ ràng. Đọc [SESSION_CONTINUITY](SESSION_CONTINUITY.md); công việc cho customer project phải bootstrap theo UUID. Sau milestone ghi checkpoint, trước kết thúc xuất handoff.

```bash
npm run doctor
npm test
npm run test:serial
npm run eval
npm run eval:production
npm run eval:quality
npm run eval:figma-contract
npm run eval:workspaces
```

Tùy phần thay đổi chạy thêm `eval:workflow`, `eval:semantic`, `eval:continuity`, `eval:recommendations`, `eval:erp`. Trên macOS, nếu temp path resolve qua symlink làm fixture bị chặn bởi evidence guard, dùng `TMPDIR=/private/tmp`; không tắt guard. Các suite offline không chứng minh semantic accuracy, live MCP hoặc customer acceptance.
