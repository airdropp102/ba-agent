# BA Studio

Không gian phân tích nghiệp vụ từ brief đến tài liệu và prototype: source-grounded requirements, câu hỏi làm rõ, BA Review, PRD/BRD/SRS/URD, Use case, User story, HTML wireframe và thiết kế Figma có bước duyệt.

## Chạy local

Yêu cầu Node.js **>=22.13** (có `node:sqlite`). Trong thư mục repository:

```bash
npm run setup
npm run doctor
npm test
npm run setup:start
```

Mở `http://127.0.0.1:3478`. `setup` giữ `.env` hiện có; cấu hình mẫu ở [.env.example](.env.example). Demo không cần API key. Dùng Codex/OpenAI thật cần cấu hình provider và quyền truyền dữ liệu phù hợp. Figma cần Bun, Codex CLI, UI UX Pro Max, TalkToFigma MCP và plugin được mở/kết nối thủ công.

## Cách dùng

1. Tạo dự án bằng brief hoặc tải nội dung text.
2. Theo dõi workflow trong Tổng quan; làm rõ câu hỏi ở Phân tích.
3. Rà soát và ghi BA Review trước khi tạo/đọc các đầu ra được bảo vệ.
4. Với dự án ERP, xác nhận nền tảng mục tiêu trong Tổng quan, tạo và BA review thiết kế giải pháp trước DELIVERABLES. Dự án thông thường bỏ qua bước này.
5. Đọc/tải PRD, BRD, SRS, URD, Use case, User story và HTML prototype. Các tab tài liệu có nút tải template Markdown trống; tài liệu đã điền yêu cầu BA Review hiện hành.
6. Trong Prototype, khởi chạy socket, nhập URL Figma/channel và xác nhận file; chờ bản vẽ, duyệt hoặc yêu cầu chỉnh sửa.
7. Bản design đã duyệt vẫn có thể yêu cầu sửa; bản mới phải duyệt lại.
8. Tab Tài liệu lưu các file bổ sung riêng theo dự án.

Workflow BA mới kết thúc ở `DELIVERABLES / COMPLETED`. Figma là tác vụ riêng tại Prototype; không còn hai bước giao diện Design Pack/publish thủ công. Công cụ/API legacy còn phục vụ tương thích và phục hồi.

## Bộ tài liệu hiện hành

| Tài liệu | Nội dung |
|---|---|
| [Mục lục](docs/README.md) | Cách đọc bộ tài liệu và phạm vi từng tài liệu |
| [Kiến trúc](docs/ARCHITECTURE.md) | Sơ đồ hệ thống, runtime, dữ liệu, ranh giới tin cậy, giới hạn |
| [Thành phần](docs/COMPONENTS.md) | Chi tiết module, trách nhiệm và input/output |
| [Workflow](docs/WORKFLOWS.md) | BA, clarification, queue, Figma, documents và session lifecycle |
| [API](docs/API.md) | Routes, payload chính, auth/version và compatibility |
| [Vận hành](docs/OPERATIONS.md) | Cấu hình, worker, backup, recovery, kiểm thử |
| [Thiết lập](SETUP.md) | Quick start và lệnh vận hành thường dùng |
| [Figma](docs/figma-handoff.md) | Relay, plugin, review/revision, preview recovery |
| [Project workspaces](docs/PROJECT_WORKSPACES.md) | UUID isolation, folders, attachments và migration |
| [Template tài liệu](docs/DOCUMENT_TEMPLATES.md) | BRD/SRS/URD theo tham chiếu 29148/BABOK; Use case, INVEST và Gherkin |
| [Clarification](docs/CLARIFICATION.md) | Draft options, authority, batch và attachments |
| [ERP](docs/ERP.md) | Domain profile, candidates, Fit–Gap, discovery |
| [Session continuity](docs/SESSION_CONTINUITY.md) | Engineering task/session/checkpoint và handoff |
| [Live acceptance](docs/LIVE_ACCEPTANCE.md) | Điều kiện chạy live, corpus, review và acceptance gates |

## Dữ liệu và giới hạn

SQLite WAL tại `DATA_DIR/ba-studio.sqlite` là nguồn chính; JSON/files là projections hoặc artifacts. Backup cần cả database và workspace. Không dùng WAL trên NFS/SMB. Customer materials, secrets và handoff không được commit vào Git.

BA Review không phải customer signoff. Điểm chất lượng là kiểm tra rule, không chứng nhận nghiệp vụ. Usage/pricing thiếu là UNKNOWN. Offline tests không chứng nhận chất lượng AI trên dữ liệu thật. Figma operator reports và gallery approval không tự thay independent read-back hoặc human visual QA.

## Phát triển

Đọc [AGENTS.md](AGENTS.md), chạy `npm run session:bootstrap`, chọn task cụ thể rồi checkpoint/handoff theo [hướng dẫn](docs/SESSION_CONTINUITY.md). Contract dữ liệu ở [canonical schema](schemas/ba-canonical-v1.schema.json). Frontend dùng HTML/CSS/JavaScript ES modules; backend dùng Node HTTP và SQLite. Không cần framework frontend hoặc build bundle.

Tài liệu theo phiên bản đã hợp nhất thành bộ tài liệu theo chủ đề. Muốn xem lịch sử release, dùng Git history; các version trong schema/migration, testcase và dữ liệu project vẫn giữ nguyên để bảo toàn tương thích.
