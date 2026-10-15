# Thiết lập BA Studio

## Chạy local

Cài Node.js >=22.13, mở terminal tại repository:

```bash
npm run setup
npm run setup:start
```

Mở `http://127.0.0.1:3478`. Setup giữ `.env` hiện có, tạo từ `.env.example` nếu chưa có. Máy mới mặc định DEMO offline. Dừng bằng Ctrl+C.

## AI và Figma

- AI thật: đặt `DEMO_MODE=false`, chọn `AI_PROVIDER=codex` với CLI đã đăng nhập hoặc `AI_PROVIDER=openai` với API key trong `.env`.
- Figma: cần Bun, Codex, UI UX Pro Max và TalkToFigma MCP/plugin đã cài. Chạy `npm run doctor:figma` để kiểm tra prerequisite local.
- Trong Prototype, khởi chạy socket, mở plugin thủ công, nhập link file và channel. Xem [luồng vẽ/duyệt](docs/figma-handoff.md).

## Dữ liệu và tác vụ kỹ thuật

Giữ cùng `DATA_DIR` khi khởi động lại. SQLite là nguồn trạng thái chính; thư mục dự án chứa tài liệu và ảnh cần backup cùng database. Xem [vận hành](docs/OPERATIONS.md) để tách worker, cấu hình bảo mật, backup và xử lý lỗi.

Trước sửa source, chạy `npm run session:bootstrap`, chọn NEW_TASK hoặc RESUME bằng task ID. Với công việc cho dự án khách hàng, thêm `-- --project <uuid>`. Ghi checkpoint và handoff theo [session continuity](docs/SESSION_CONTINUITY.md).

Bắt đầu đọc hệ thống tại [mục lục tài liệu](docs/README.md).
